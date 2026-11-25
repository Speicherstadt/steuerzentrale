import { afterEach, describe, expect, it } from "vitest";
import { ntfyServer } from "../../testhilfen/ntfy.ts";
import { istOeffentlicheAdresse } from "../dns/plan.ts";
import { ntfyNachricht, ntfySenden, ntfyThema } from "./ntfy.ts";
import type { WebhookDeps } from "./oeffentlich.ts";

/*
 * BAULISTE.md Z-1105: a message to ntfy is published as JSON to the server's root (ntfy docs,
 * "Publish as JSON") with the topic, a title and a priority by severity; the access token goes in
 * the Authorization header; the address is the operator's, so only public https addresses are
 * reached in production, as for a webhook.
 */
const T = Date.UTC(2026, 10, 23, 12);

const stopper: (() => unknown)[] = [];
afterEach(() => {
  for (const s of stopper.splice(0)) s();
});

const server = (o: Parameters<typeof ntfyServer>[0] = {}) => {
  const s = ntfyServer(o);
  stopper.push(s.stoppen);
  return s;
};

const imTest: WebhookDeps = {
  fetch,
  aufloesen: async () => ["127.0.0.1"],
  adresseErlaubt: () => true,
  nurHttps: false,
  zeitlimitMs: 5000,
};

const ereignis = (art: string, schwere: string, text = "Störung Wiki: seit 5 Min. außen rot") => ({
  ereignisId: "e1",
  zeitpunkt: T,
  art,
  schwere,
  ziel: "dienst:d1",
  text,
});

describe("ntfyNachricht", () => {
  it.each([
    ["stoerung", "fehler", "fehler", "Störung", 5, ["rotating_light"]],
    ["aussen_rot", "warn", "warn", "Warnung", 4, ["warning"]],
    ["agent_aktualisiert", "info", "info", "Hinweis", 3, ["information_source"]],
    ["stoerung_behoben", "info", "fehler", "Behoben", 3, ["white_check_mark"]],
  ] as const)("titles %s (%s) as „%s“ with priority %i", (art, schwere, mit, titel, prio, tags) => {
    expect(ntfyNachricht(ereignis(art, schwere), { zustellungId: "e1.r1", schwere: mit })).toEqual({
      title: titel,
      message: "Störung Wiki: seit 5 Min. außen rot",
      priority: prio,
      tags,
    });
  });
});

describe("ntfyThema", () => {
  it.each([
    ["https://ntfy.sh/sz-alarm", { basis: "https://ntfy.sh/", topic: "sz-alarm" }],
    [
      "https://push.example.de/ntfy/alarm_1",
      { basis: "https://push.example.de/ntfy/", topic: "alarm_1" },
    ],
  ])("splits %s into the server and the topic", (url, teile) => {
    expect(ntfyThema(url)).toEqual(teile);
  });

  it.each([
    "https://ntfy.sh/",
    "https://ntfy.sh/a/",
    "https://ntfy.sh/al arm",
    "https://ntfy.sh/alarm?x=1",
    "https://ntfy.sh/alarm#a",
    "https://kim:pw@ntfy.sh/alarm",
    `https://ntfy.sh/${"a".repeat(65)}`,
    "ftp://ntfy.sh/alarm",
  ])("refuses %s", (url) => {
    expect(ntfyThema(url)).toBeUndefined();
  });
});

describe("ntfySenden", () => {
  it("publishes JSON to the server's root with topic, title, priority and the token", async () => {
    const s = server({ token: "tk_geheim0123456789" });
    const r = await ntfySenden(
      imTest,
      { url: s.url("sz-alarm"), token: "tk_geheim0123456789" },
      { title: "Störung", message: "Störung i1", priority: 5, tags: ["rotating_light"] },
    );
    expect(r).toEqual({ ok: true });
    expect(s.empfangen).toEqual([
      {
        pfad: "/",
        auth: "Bearer tk_geheim0123456789",
        json: {
          topic: "sz-alarm",
          title: "Störung",
          message: "Störung i1",
          priority: 5,
          tags: ["rotating_light"],
        },
        status: 200,
      },
    ]);
  });

  it("sends no Authorization header for a public topic, and reports a refusal", async () => {
    const s = server({ token: "tk_noetig" });
    const r = await ntfySenden(
      imTest,
      { url: s.url(), token: null },
      { title: "Hinweis", message: "x", priority: 3, tags: [] },
    );
    expect(r).toEqual({ ok: false, fehler: "ntfy HTTP 403" });
    expect(s.empfangen[0]?.auth).toBeNull();
  });

  it("reaches only public https addresses in production", async () => {
    const s = server();
    const imBetrieb = { ...imTest, adresseErlaubt: istOeffentlicheAdresse, nurHttps: true };
    const n = { title: "Hinweis", message: "x", priority: 3, tags: [] };
    expect(await ntfySenden(imBetrieb, { url: s.url(), token: null }, n)).toEqual({
      ok: false,
      fehler: "ntfy: https only",
    });
    const https = s.url().replace("http:", "https:");
    expect(await ntfySenden(imBetrieb, { url: https, token: null }, n)).toEqual({
      ok: false,
      fehler: "ntfy: address not public",
    });
    expect(s.empfangen).toEqual([]);
  });
});
