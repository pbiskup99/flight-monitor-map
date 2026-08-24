import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FlightState } from "../data/opensky";

/**
 * Renders a 3D aircraft model in the "selected flight" side panel. Loading
 * pipeline: try `modelUrl` (a real .gltf/.glb, per the brief) first via
 * GLTFLoader; if none is configured or the fetch fails (offline demo, no
 * bundled asset), fall back to a procedurally built low-poly aircraft mesh
 * so the panel never shows a blank canvas.
 */

export interface PlaneModelOptions {
  /** Optional URL to a real glTF/glb aircraft model. */
  modelUrl?: string;
}

function buildProceduralPlane(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x1a1a19, metalness: 0.2, roughness: 0.6 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 2.2, 6, 12), bodyMat);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 12), bodyMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 1.6;
  group.add(nose);

  const wingGeo = new THREE.BoxGeometry(0.9, 0.05, 3.4);
  const wing = new THREE.Mesh(wingGeo, accentMat);
  wing.position.set(-0.1, -0.05, 0);
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 1.3), accentMat);
  tailWing.position.set(-1.15, 0.05, 0);
  group.add(tailWing);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.06), accentMat);
  fin.position.set(-1.15, 0.4, 0);
  group.add(fin);

  const engineGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.55, 10);
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(engineGeo, accentMat);
    engine.rotation.z = Math.PI / 2;
    engine.position.set(0.1, -0.28, side * 1.15);
    group.add(engine);
  }

  return group;
}

export class PlaneModelViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private plane: THREE.Group | null = null;
  private clock = new THREE.Clock();
  private raf: number | null = null;
  private loader = new GLTFLoader();
  private loadSeq = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(3.4, 1.6, 3.4);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 5, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x4a5a80, 0.9));
    const rim = new THREE.DirectionalLight(0x3987e5, 0.8);
    rim.position.set(-4, -2, -3);
    this.scene.add(rim);

    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async showFlight(flight: FlightState, opts: PlaneModelOptions = {}) {
    // The canvas lives inside a panel that's `display:none` until the first
    // flight is selected, so the constructor's resize() ran against a 0px
    // (clientWidth/Height) canvas and sized the renderer to 1x1. Now that
    // the panel is actually visible, size it for real.
    this.resize();

    // GLTFLoader's fetch+parse is async, so a second showFlight() (clicking
    // another plane before the first model finishes loading) can resolve
    // out of order. Without this guard the stale response would still run
    // scene.add() after the newer call already added its own model — two
    // planes in the scene, only one of them driven by the render loop (the
    // other frozen in whatever pose it was added with). Bumping a sequence
    // number and checking it after every await lets a superseded load bail
    // out instead of touching the scene at all.
    const seq = ++this.loadSeq;
    const color = flight.onGround ? 0x898781 : (flight.verticalRate ?? 0) < -1 ? 0xd95926 : 0x3987e5;

    let nextPlane: THREE.Group;
    if (opts.modelUrl) {
      try {
        const gltf = await this.loader.loadAsync(opts.modelUrl);
        if (seq !== this.loadSeq) return;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const scale = 2.4 / Math.max(size.x, size.y, size.z, 0.001);
        gltf.scene.scale.setScalar(scale);
        nextPlane = gltf.scene as unknown as THREE.Group;
      } catch {
        if (seq !== this.loadSeq) return;
        nextPlane = buildProceduralPlane(color);
      }
    } else {
      nextPlane = buildProceduralPlane(color);
    }
    if (seq !== this.loadSeq) return;

    if (this.plane) {
      this.scene.remove(this.plane);
    }
    this.plane = nextPlane;

    // Pitch the nose up/down with the aircraft's real climb/descent rate.
    const vr = flight.verticalRate ?? 0;
    this.plane.rotation.z = THREE.MathUtils.clamp(vr / 15, -0.35, 0.35);
    this.scene.add(this.plane);

    if (!this.raf) this.animate();
  }

  clear() {
    this.loadSeq++; // invalidate any in-flight load so it can't add itself after clearing
    if (this.plane) {
      this.scene.remove(this.plane);
      this.plane = null;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.renderer.clear();
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();
    if (this.plane) {
      this.plane.rotation.y += dt * 0.6;
    }
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
