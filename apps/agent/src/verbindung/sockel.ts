/*
 * The WebSocket as the connection loop uses it, passed in so the loop can be tested without a
 * network. The real one is Bun's WebSocket client with the agent's client certificate.
 */
export type Ereignisse = {
  offen: () => void;
  nachricht: (text: string) => void;
  zu: (code: number, grund: string) => void;
};

export type Sockel = {
  senden: (text: string) => void;
  schliessen: (code: number, grund: string) => void;
};

export type Tls = { cert: string; key: string; ca?: string };

export type Oeffnen = (url: string, tls: Tls, ereignisse: Ereignisse) => Sockel;

// Bun's WebSocket takes TLS options; the DOM's declaration of the global hides that overload
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  optionen: Bun.WebSocketOptions,
) => WebSocket;

export const echtOeffnen: Oeffnen = (url, tls, ereignisse) => {
  const ws = new BunWebSocket(url, { tls });
  let beendet = false;
  ws.onopen = () => ereignisse.offen();
  ws.onmessage = (event) => {
    if (typeof event.data === "string") ereignisse.nachricht(event.data);
  };
  ws.onclose = (event) => {
    if (beendet) return;
    beendet = true;
    ereignisse.zu(event.code, event.reason);
  };
  return {
    senden: (text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    schliessen: (code, grund) => ws.close(code, grund),
  };
};
