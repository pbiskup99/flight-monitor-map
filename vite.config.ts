import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";
const OPENSKY_FLIGHTS_URL = "https://opensky-network.org/api/flights/aircraft";
const PROXY_TARGETS: Record<string, string> = {
  "/api/opensky/states": OPENSKY_STATES_URL,
  "/api/opensky/flights": OPENSKY_FLIGHTS_URL
};

/**
 * Dev-server-only proxy for OpenSky's authenticated (OAuth2 client-credentials)
 * REST API. The client_id/client_secret live only in this Node process (read
 * from .env.local, gitignored) — the browser never sees them, it only ever
 * talks to same-origin `PROXY_PATH`. This is what makes it safe to use real
 * OpenSky account credentials at all: baking them into client-side JS would
 * ship them to every visitor's browser instead.
 */
function openSkyProxyPlugin(env: Record<string, string>): Plugin {
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
      return cachedToken.value;
    }
    const clientId = env.OPENSKY_CLIENT_ID;
    const clientSecret = env.OPENSKY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET. Copy .env.local.example to .env.local and fill them in."
      );
    }
    const res = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      })
    });
    if (!res.ok) {
      throw new Error(`OpenSky token request failed: HTTP ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000
    };
    return cachedToken.value;
  }

  return {
    name: "opensky-oauth-proxy",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? "/", "http://internal");
        const targetBase = PROXY_TARGETS[url.pathname];
        if (!targetBase) {
          next();
          return;
        }
        try {
          const token = await getAccessToken();
          const target = new URL(targetBase);
          target.search = url.search;
          const upstream = await fetch(target, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const body = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
          res.end(body);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "proxy error" }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [openSkyProxyPlugin(env)],
    server: {
      port: 5173,
      open: false
    },
    build: {
      target: "es2022",
      sourcemap: true
    }
  };
});
