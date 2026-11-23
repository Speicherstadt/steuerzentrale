import { afterEach, describe, expect, it } from "vitest";
import { testPforte } from "./testpforte.ts";
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
});
