/*
 * A WebSocket client for the connection tests, as an agent would open it: with its client
 * certificate, trusting the Pforte's test CA. It keeps what arrives and how the connection ended.
 */
// Bun's WebSocket takes TLS options; the DOM's declaration of the global hides that overload
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  optionen: Bun.WebSocketOptions,
) => WebSocket;

export type TestClient = {
  /** Resolves when open, or with the reason it never opened */
  offen: Promise<boolean>;
  /** Resolves with the close code and reason */
  zu: Promise<{ code: number; grund: string }>;
  /** The next message, parsed */
  naechste: () => Promise<Record<string, unknown>>;
  senden: (nachricht: unknown) => void;
  schliessen: () => void;
};

export const testClient = (
  url: string,
  tls: { cert?: string; key?: string; ca: string },
): TestClient => {
  const ws = new BunWebSocket(url, { tls });
  const eingang: Record<string, unknown>[] = [];
  const wartende: ((n: Record<string, unknown>) => void)[] = [];
  ws.onmessage = (event) => {
    const nachricht = JSON.parse(String(event.data)) as Record<string, unknown>;
    const warten = wartende.shift();
    if (warten) warten(nachricht);
    else eingang.push(nachricht);
  };
  const offen = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.addEventListener("close", () => resolve(false));
  });
  const zu = new Promise<{ code: number; grund: string }>((resolve) => {
    ws.addEventListener("close", (event) => resolve({ code: event.code, grund: event.reason }));
  });
  return {
    offen,
    zu,
    naechste: () => {
      const vorhanden = eingang.shift();
      return vorhanden
        ? Promise.resolve(vorhanden)
        : new Promise((resolve) => wartende.push(resolve));
    },
    senden: (nachricht) => ws.send(JSON.stringify(nachricht)),
    schliessen: () => ws.close(),
  };
};
