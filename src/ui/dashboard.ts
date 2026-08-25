import type { FlightState } from "../data/opensky";

/** Thin DOM-binding layer for the HUD chrome around the map — stat tiles,
 * layer toggles, region picker and the flight-detail panel. Kept separate
 * from the rendering/data modules so main.ts stays focused on wiring. */

export interface Toggles {
  icons: boolean;
}

export class Dashboard {
  readonly toggles: Toggles = {
    icons: true
  };

  private el = {
    planes: document.getElementById("stat-planes")!,
    updated: document.getElementById("stat-updated")!,
    fps: document.getElementById("stat-fps")!,
    loading: document.getElementById("loading")!,
    region: document.getElementById("region-select") as HTMLSelectElement,
    flightEmpty: document.getElementById("flight-empty")!,
    flightInfo: document.getElementById("flight-info")!,
    flightFields: document.getElementById("flight-fields")!,
    flightFrom: document.getElementById("flight-from")!,
    flightTo: document.getElementById("flight-to")!,
    flightClose: document.getElementById("flight-close")!,
    panel: document.getElementById("panel")!,
    panelToggle: document.getElementById("panel-toggle")!,
    panelTitle: document.getElementById("panel-title")!
  };

  private toggleIds: Array<[keyof Toggles, string]> = [["icons", "toggle-icons"]];

  onToggleChange: ((toggles: Toggles) => void) | null = null;
  onRegionChange: ((region: string) => void) | null = null;
  onDeselect: (() => void) | null = null;

  constructor() {
    for (const [key, id] of this.toggleIds) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (!input) continue;
      input.checked = this.toggles[key];
      input.addEventListener("change", () => {
        this.toggles[key] = input.checked;
        this.onToggleChange?.(this.toggles);
      });
    }

    this.el.region.addEventListener("change", () => {
      this.onRegionChange?.(this.el.region.value);
    });

    this.el.flightClose.addEventListener("click", () => {
      this.onDeselect?.();
    });

    // Mobile-only control (the button itself is display:none above the
    // 760px breakpoint — see style.css) — the panel sits right under the
    // header on a phone and would otherwise cover most of the map with no
    // way to get it out of the way. Collapsed state relabels the section
    // heading itself ("Layers" -> "Menu") rather than leaving a bare,
    // unlabeled bar, so it's clear the strip is still interactive.
    this.el.panelToggle.addEventListener("click", () => {
      this.setPanelCollapsed(!this.el.panel.classList.contains("collapsed"));
    });

    // The collapse/expand behavior (and the toggle button itself) only
    // applies below the 760px breakpoint — see the matching media query in
    // style.css. If the panel was left collapsed and the viewport then
    // widens past that breakpoint (window resize, device rotation/unfold),
    // force it back to expanded so the "Menu — tap to expand" label doesn't
    // get stuck on a layout where the toggle to undo it is hidden.
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    mobileQuery.addEventListener("change", (e) => {
      if (!e.matches) this.setPanelCollapsed(false);
    });
  }

  private setPanelCollapsed(collapsed: boolean) {
    this.el.panel.classList.toggle("collapsed", collapsed);
    this.el.panelToggle.setAttribute("aria-expanded", String(!collapsed));
    this.el.panelToggle.setAttribute("aria-label", collapsed ? "Expand menu" : "Collapse menu");
    this.el.panelTitle.textContent = collapsed ? "Menu — tap to expand" : "Layers";
  }

  setLoading(loading: boolean, message?: string) {
    this.el.loading.classList.toggle("hidden", !loading);
    this.el.loading.classList.remove("demo");
    if (message) this.el.loading.textContent = message;
  }

  /** Persistent badge shown while the map is displaying synthetic demo
   * flights because OpenSky couldn't be reached — distinct styling from the
   * transient "connecting…" state so it reads as "known limitation", not
   * "still loading". */
  setDemoMode(active: boolean) {
    this.el.loading.classList.toggle("hidden", !active);
    this.el.loading.classList.toggle("demo", active);
    if (active) {
      this.el.loading.textContent = "Demo mode — OpenSky Network unavailable (503), showing simulated flights";
    }
  }

  updateFleetStats(count: number, updatedAt: number | null, error: string | null) {
    this.el.planes.textContent = count.toLocaleString("en-US");
    if (error) {
      this.el.updated.textContent = "error";
      this.el.updated.title = error;
    } else if (updatedAt) {
      const secondsAgo = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
      this.el.updated.textContent = secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`;
      this.el.updated.title = "";
    }
  }

  updateFps(fps: number) {
    this.el.fps.textContent = String(Math.round(fps));
  }

  showFlight(flight: FlightState) {
    this.el.flightEmpty.classList.add("hidden");
    this.el.flightInfo.classList.remove("hidden");
    this.el.flightClose.classList.remove("hidden");

    const rows: [string, string][] = [
      ["Callsign", flight.callsign],
      ["Country", flight.originCountry],
      ["Altitude", flight.geoAltitude != null ? `${Math.round(flight.geoAltitude)} m` : "—"],
      ["Speed", flight.velocity != null ? `${Math.round(flight.velocity * 3.6)} km/h` : "—"],
      ["Heading", flight.trueTrack != null ? `${Math.round(flight.trueTrack)}°` : "—"],
      ["Vert. speed", flight.verticalRate != null ? `${flight.verticalRate.toFixed(1)} m/s` : "—"]
    ];
    this.el.flightFields.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
  }

  clearFlight() {
    this.el.flightEmpty.classList.remove("hidden");
    this.el.flightInfo.classList.add("hidden");
    this.el.flightClose.classList.add("hidden");
  }

  /** Route (departure/arrival airport) comes from a separate, slower lookup
   * than the rest of the flight fields — shown as "…" until it resolves. */
  setRouteLoading() {
    this.el.flightFrom.textContent = "…";
    this.el.flightTo.textContent = "…";
  }

  setRoute(departureAirport: string | null, arrivalAirport: string | null) {
    this.el.flightFrom.textContent = departureAirport ?? "unknown";
    // OpenSky only learns the arrival airport after the aircraft lands, so
    // an in-progress flight legitimately has no destination yet.
    this.el.flightTo.textContent = arrivalAirport ?? "in progress";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
