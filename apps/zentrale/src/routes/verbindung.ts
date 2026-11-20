import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { serverZumFingerabdruck } from "../modules/server/index.ts";
import { sitzung } from "../modules/verbindung/sitzung.ts";
import type { Sockel } from "../modules/verbindung/verbindungen.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

const sockelVon = (ws: WSContext): Sockel => ({
  senden: (text) => ws.send(text),
  schliessen: (code, grund) => ws.close(code, grund),
});

/**
 * The agent's connection (BAULISTE.md Z-303): a WebSocket, reached only with the client certificate
 * of a server that is not revoked (the guard in zugang.ts). Bun's WebSocket server pings an idle
 * connection and closes a dead one after its idle timeout (120 s), so a connection whose agent is
 * gone does not stay "verbunden".
 */
export const verbindungRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/agent/verbindung", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ fehler: "kein_websocket" }, 426);
    const angemeldet = serverZumFingerabdruck(deps.db, c.get("fingerabdruck"));
    if (!angemeldet) return c.json({ fehler: "kein_zertifikat" }, 401);
    const s = sitzung(deps, angemeldet);
    return upgradeWebSocket(c, {
      onOpen: (_event, ws) => s.offen(sockelVon(ws)),
      onMessage: (event, _ws) => s.nachricht(event.data as string | ArrayBuffer),
      onClose: () => s.zu(),
    });
  });
};
