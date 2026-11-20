import type { Server } from "bun";
import type { Hono } from "hono";
import { websocket } from "hono/bun";
import type { Anfrage } from "../routes/zugang.ts";

/** The test Zentrale on a real port of 127.0.0.1, with the agents' WebSocket, as main.ts serves it */
export const zentraleStarten = (app: Hono<Anfrage>, port = 0): Server<unknown> =>
  Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch, websocket });
