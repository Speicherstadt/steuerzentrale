import { afterEach, describe, expect, it } from "vitest";
import { antwortKopfUmschreiben, testPforte } from "./testpforte.ts";
import { pforteTls } from "./tls.ts";

/*
 * The test Pforte passes large answers on whole: the agent's binary (about 60 MB) goes through it
 * in CI (job `server`), and a socket takes only what fits at once.
 */
const aufraeumen: (() => void)[] = [];
afterEach(() => {
  for (const f of aufraeumen.splice(0)) f();
});

describe("testPforte", () => {
  it("passes on a large answer and a large request body without losing bytes", async () => {
    const gross = new Uint8Array(32 * 1024 * 1024).map((_, i) => i % 251);
    const ziel = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) =>
        req.method === "POST"
          ? new Response(String((await req.arrayBuffer()).byteLength))
          : new Response(gross),
    });
    const tls = await pforteTls();
    const pforte = testPforte({ ziel: ziel.port ?? 0, ...tls, clientCas: [tls.ca] });
    aufraeumen.push(
      () => pforte.stoppen(),
      () => ziel.stop(true),
    );
    const url = `https://127.0.0.1:${pforte.port}/`;
    const antwort = await fetch(url, { tls: { ca: tls.ca } });
    const empfangen = new Uint8Array(await antwort.arrayBuffer());
    expect(empfangen.length).toBe(gross.length);
    expect(Buffer.from(empfangen).equals(Buffer.from(gross))).toBe(true);
    const gesendet = await fetch(url, { method: "POST", body: gross, tls: { ca: tls.ca } });
    expect(await gesendet.text()).toBe(String(gross.length));
  }, 30_000);

  it("tells the client the connection closes, so it does not send a second request on it", async () => {
    const ziel = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ja") });
    const tls = await pforteTls();
    const pforte = testPforte({ ziel: ziel.port ?? 0, ...tls, clientCas: [tls.ca] });
    aufraeumen.push(
      () => pforte.stoppen(),
      () => ziel.stop(true),
    );
    const antwort = await fetch(`https://127.0.0.1:${pforte.port}/`, { tls: { ca: tls.ca } });
    expect(antwort.headers.get("connection")).toBe("close");
    expect(await antwort.text()).toBe("ja");
  });
});

describe("antwortKopfUmschreiben", () => {
  it("replaces the connection header of an answer with close", () => {
    expect(
      antwortKopfUmschreiben(
        "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 1\r\n\r\n",
      ),
    ).toBe("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nconnection: close\r\n\r\n");
  });

  it("leaves a WebSocket upgrade as it is", () => {
    const kopf =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
    expect(antwortKopfUmschreiben(kopf)).toBe(kopf);
  });
});
