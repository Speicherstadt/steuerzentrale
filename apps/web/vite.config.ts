import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

// A static SPA; the Hono server of the Zentrale serves the API (CLAUDE.md, "Code style"). Vite passes
// /api and /health on to it under the app's own origin (dev 18300, e2e 28300; CLAUDE.md, "Working rules").
const api = `http://127.0.0.1:${process.env.STEUERZENTRALE_API_PORT ?? "18300"}`;
const proxy = { "/api": api, "/health": api };

// The demo on the docs site (`bun run build:demo`, .github/workflows/docs.yml) lives under /demo/;
// the Zentrale serves the interface at the root
const base = process.env.STEUERZENTRALE_WEB_BASE ?? "/";

// File-based routes in src/routes, the tree in src/routeTree.gen.ts (as in Speicherstadt/soll)
export default defineConfig({
  plugins: [tanstackRouter({ target: "solid", autoCodeSplitting: true }), solid(), tailwindcss()],
  base,
  server: { proxy },
  preview: { proxy },
  build: { target: "es2024" },
});
