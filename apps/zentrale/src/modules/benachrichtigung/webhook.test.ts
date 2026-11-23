import { afterEach, describe, expect, it } from "vitest";
import { pforteTls } from "../../testhilfen/tls.ts";
import { webhookEmpfaenger } from "../../testhilfen/webhook.ts";
import { istOeffentlicheAdresse, type WebhookDeps, webhookSenden } from "./webhook.ts";

/*
 * BAULISTE.md Z-703: a webhook goes out signed, the test receiver checks the signature and notices
 * a forged one; only public addresses are reached in production, and the request goes to the
 * address that was checked, with the host as Host header and TLS name.
 */
const SCHLUESSEL = "empfaenger-schluessel-0123456789abcdef01234567";
const T = Date.UTC(2026, 10, 23, 12);
const NACHRICHT = { zustellungId: "e1.r1", body: JSON.stringify({ text: "Störung i1" }) };

const stopper: (() => unknown)[] = [];
afterEach(() => {
  for (const s of stopper.splice(0)) s();
});

const empfaenger = (o: Parameters<typeof webhookEmpfaenger>[1] = {}) => {
  const e = webhookEmpfaenger(SCHLUESSEL, { jetzt: () => T, ...o });
  stopper.push(e.stoppen);
  return e;
};

/** Tests reach the receiver on localhost over http; production allows public https only */
const imTest: WebhookDeps = {
  fetch,
  aufloesen: async () => ["127.0.0.1"],
  adresseErlaubt: () => true,
  nurHttps: false,
  zeitlimitMs: 5000,
};
const wieImBetrieb: WebhookDeps = {
  ...imTest,
  adresseErlaubt: istOeffentlicheAdresse,
  nurHttps: true,
};

describe("webhookSenden", () => {
  it("posts the body signed, with the delivery's id, and the receiver's check holds", async () => {
    const e = empfaenger();
    const r = await webhookSenden(imTest, { url: e.url(), schluessel: SCHLUESSEL }, NACHRICHT, T);
    expect(r).toEqual({ ok: true });
    expect(e.empfangen).toEqual([
      {
        zustellungId: "e1.r1",
        body: NACHRICHT.body,
        host: `127.0.0.1:${e.port}`,
        signatur: { ok: true },
        status: 204,
      },
    ]);
  });

  it("is noticed by the receiver when signed with another key, and counts as not delivered", async () => {
    const e = empfaenger();
    const falsch = { url: e.url(), schluessel: "gefaelschter-schluessel-00000000000000000" };
    expect(await webhookSenden(imTest, falsch, NACHRICHT, T)).toEqual({
      ok: false,
      fehler: "webhook HTTP 401",
    });
    expect(e.empfangen[0]?.signatur).toEqual({ ok: false, grund: "falsch" });
  });

  it("goes to the checked address with the host as Host header and TLS name", async () => {
    const tls = await pforteTls(T);
    const e = empfaenger({ tls: { cert: tls.zertifikat, key: tls.schluessel } });
    const aufgeloest: string[] = [];
    const deps = {
      ...imTest,
      nurHttps: true,
      ca: tls.ca,
      aufloesen: async (host: string) => {
        aufgeloest.push(host);
        return ["127.0.0.1"];
      },
    };
    const ziel = { url: `https://localhost:${e.port}/hooks`, schluessel: SCHLUESSEL };
    expect(await webhookSenden(deps, ziel, NACHRICHT, T)).toEqual({ ok: true });
    expect(aufgeloest).toEqual(["localhost"]);
    expect(e.empfangen[0]?.host).toBe(`localhost:${e.port}`);
  });

  it("reaches no address that is not public, and no plain http, in production", async () => {
    const e = empfaenger();
    const r = await webhookSenden(
      { ...wieImBetrieb, nurHttps: false },
      { url: e.url(), schluessel: SCHLUESSEL },
      NACHRICHT,
      T,
    );
    expect(r).toEqual({ ok: false, fehler: "webhook: address not public" });
    for (const privat of ["10.0.0.5", "192.168.1.1", "100.64.0.1", "169.254.169.254", "::1"]) {
      const deps = { ...wieImBetrieb, aufloesen: async () => ["203.0.113.7", privat] };
      const ziel = { url: "https://hooks.example/a", schluessel: SCHLUESSEL };
      expect(await webhookSenden(deps, ziel, NACHRICHT, T), privat).toEqual({
        ok: false,
        fehler: "webhook: address not public",
      });
    }
    expect(
      await webhookSenden(
        wieImBetrieb,
        { url: "http://hooks.example/a", schluessel: SCHLUESSEL },
        NACHRICHT,
        T,
      ),
    ).toEqual({ ok: false, fehler: "webhook: https only" });
    expect(e.empfangen).toEqual([]);
  });

  it("reports a receiver that is down or answers with an error", async () => {
    const e = empfaenger();
    e.scheitern(1);
    const ziel = { url: e.url(), schluessel: SCHLUESSEL };
    expect(await webhookSenden(imTest, ziel, NACHRICHT, T)).toEqual({
      ok: false,
      fehler: "webhook HTTP 503",
    });
    e.stoppen();
    const weg = await webhookSenden(imTest, ziel, NACHRICHT, T);
    expect(weg.ok).toBe(false);
  });
});

describe("istOeffentlicheAdresse", () => {
  it("allows public unicast addresses only", () => {
    for (const ja of ["203.0.113.7", "8.8.8.8", "2a01:4f8::1"])
      expect(istOeffentlicheAdresse(ja), ja).toBe(true);
    for (const nein of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.1",
      "100.64.0.1",
      "169.254.1.1",
      "0.1.2.3",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "kein",
    ])
      expect(istOeffentlicheAdresse(nein), nein).toBe(false);
  });
});
