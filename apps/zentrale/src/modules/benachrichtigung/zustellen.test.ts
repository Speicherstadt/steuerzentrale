import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { auditLog, zustellungen } from "../../db/schema.ts";
import {
  benachrichtigungsUmgebung,
  ereignisSchreiben,
  smtpBei,
  T0,
} from "../../testhilfen/benachrichtigung.ts";
import { eintrag, zustandNachricht } from "../../testhilfen/bewertung.ts";
import { mailInhalt, smtpNachbau } from "../../testhilfen/smtp.ts";
import { webhookEmpfaenger } from "../../testhilfen/webhook.ts";
import { bewertungenPruefen, zustandAnnehmen } from "../bewertung/index.ts";
import { empfaengerEntfernen } from "./empfaenger.ts";
import { MAX_VERSUCHE, wartezeit } from "./zustellen.ts";

/*
 * BAULISTE.md Z-703, "Fertig, wenn": a fault that lasts 10 checks makes one mail and its fix a
 * second; a delivery is repeated after the receiver failed. Further: a fault goes out in quiet
 * hours, a warning waits for their end; each recipient gets what its threshold asks for; a
 * delivery is given up after 10 attempts.
 */
const S = 1000;
const MIN = 60 * S;
const SCHLUESSEL = "empfaenger-schluessel-0123456789abcdef01234567";

const stopper: (() => unknown)[] = [];
afterEach(async () => {
  for (const s of stopper.splice(0)) await s();
});

const mitSmtp = async () => {
  const smtp = await smtpNachbau();
  stopper.push(smtp.stoppen);
  const u = benachrichtigungsUmgebung();
  u.einstellen("b1", { smtp: smtpBei(smtp.port), ruhezeit: null });
  return { u, smtp };
};

const empfaenger = (u: { uhr: { ms: number } }) => {
  const e = webhookEmpfaenger(SCHLUESSEL, { jetzt: () => u.uhr.ms });
  stopper.push(e.stoppen);
  return e;
};

const zeilen = (u: ReturnType<typeof benachrichtigungsUmgebung>) =>
  u.db.select().from(zustellungen).all();

describe("a fault", () => {
  it("that lasts 10 checks makes one mail, and its fix a second", async () => {
    const { u, smtp } = await mitSmtp();
    u.empfaenger("b1", { art: "mail", adresse: "betrieb@betreiber.test", abSchwere: "warn" });
    const deps = { db: u.db, schreibDb: u.schreibDb, log: () => {} };
    /** A report of i1 (of b1, and of b2's i1 too, which has no recipient), the check and the loop */
    const pruefung = async (health: "gruen" | "rot") => {
      for (const betreiberId of ["b1", "b2"])
        zustandAnnehmen(
          deps,
          { betreiberId, serverId: "s1" },
          zustandNachricht([eintrag("i1", health)]),
          u.uhr.ms,
        );
      bewertungenPruefen(u.db, u.schreibDb, u.uhr.ms);
      await u.lauf();
      u.uhr.ms += 30 * S;
    };
    // five minutes of red before it is a fault: no mail yet
    while (u.uhr.ms < T0 + 5 * MIN) await pruefung("rot");
    expect(smtp.empfangen).toEqual([]);
    for (let i = 0; i < 10; i++) await pruefung("rot");
    expect(smtp.empfangen).toHaveLength(1);
    const erste = mailInhalt(smtp.empfangen[0]?.daten ?? "");
    expect(smtp.empfangen[0]?.an).toEqual(["betrieb@betreiber.test"]);
    expect(erste.text).toContain("Störung i1: seit 5 Min. rot; Health: HTTP 503");
    for (let i = 0; i < 3; i++) await pruefung("gruen");
    expect(smtp.empfangen).toHaveLength(2);
    expect(mailInhalt(smtp.empfangen[1]?.daten ?? "").text).toContain(
      "Störung i1 behoben: wieder grün",
    );
    expect(zeilen(u).map((z) => [z.betreiberId, z.schwere, z.zustand, z.versuche])).toEqual([
      ["b1", "fehler", "zugestellt", 1],
      ["b1", "fehler", "zugestellt", 1],
    ]);
  });
});

describe("a delivery after the receiver failed", () => {
  it("is repeated after 1 and 2 minutes, with the same id, until it arrives", async () => {
    const u = benachrichtigungsUmgebung();
    const e = empfaenger(u);
    u.empfaenger("b1", { art: "webhook", url: e.url(), schluessel: SCHLUESSEL, abSchwere: "info" });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "server_still",
      schwere: "warn",
    });
    e.scheitern(2);
    expect(await u.lauf()).toEqual({ angelegt: 1, zugestellt: 0, gescheitert: 1, gehalten: 0 });
    expect(zeilen(u)[0]).toMatchObject({
      zustand: "wartet",
      versuche: 1,
      fehler: "webhook HTTP 503",
      faelligAm: T0 + MIN,
    });
    u.uhr.ms = T0 + 59 * S;
    expect(await u.lauf()).toEqual({ angelegt: 0, zugestellt: 0, gescheitert: 0, gehalten: 0 });
    u.uhr.ms = T0 + MIN;
    await u.lauf();
    expect(zeilen(u)[0]).toMatchObject({ versuche: 2, faelligAm: T0 + 3 * MIN });
    u.uhr.ms = T0 + 3 * MIN;
    expect(await u.lauf()).toMatchObject({ zugestellt: 1 });
    expect(zeilen(u)[0]).toMatchObject({ zustand: "zugestellt", versuche: 3, fehler: null });
    expect(e.empfangen.map((x) => [x.status, x.zustellungId])).toEqual([
      [503, zeilen(u)[0]?.zustellungId],
      [503, zeilen(u)[0]?.zustellungId],
      [204, zeilen(u)[0]?.zustellungId],
    ]);
    expect(e.empfangen.every((x) => x.signatur.ok)).toBe(true);
    const body = JSON.parse(e.empfangen[2]?.body ?? "{}");
    expect(body).toMatchObject({
      typ: "ereignis",
      text: "[Warnung] server_still auf s1",
      ereignis: { art: "server_still", schwere: "warn", ziel: "server:s1" },
    });
  });

  it("is given up after 10 attempts, waiting at most an hour between two", async () => {
    const u = benachrichtigungsUmgebung();
    const e = empfaenger(u);
    u.empfaenger("b1", { art: "webhook", url: e.url(), schluessel: SCHLUESSEL, abSchwere: "info" });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "dns_fehler",
      schwere: "warn",
    });
    e.scheitern(100);
    for (let i = 1; i <= MAX_VERSUCHE; i++) {
      await u.lauf();
      u.uhr.ms += wartezeit(i);
    }
    expect([1, 2, 3, 7, 8, 9].map(wartezeit)).toEqual([
      MIN,
      2 * MIN,
      4 * MIN,
      60 * MIN,
      60 * MIN,
      60 * MIN,
    ]);
    expect(zeilen(u)[0]).toMatchObject({ zustand: "aufgegeben", versuche: MAX_VERSUCHE });
    await u.lauf();
    expect(e.empfangen).toHaveLength(MAX_VERSUCHE);
  });

  it("waits for a mail server that is not set yet, and goes out once it is", async () => {
    const smtp = await smtpNachbau();
    stopper.push(smtp.stoppen);
    const u = benachrichtigungsUmgebung();
    u.empfaenger("b1", { art: "mail", adresse: "betrieb@betreiber.test", abSchwere: "info" });
    ereignisSchreiben(u.schreibDb, "b1", { zeitpunkt: u.uhr.ms, art: "x", schwere: "fehler" });
    await u.lauf();
    expect(zeilen(u)[0]).toMatchObject({ versuche: 1, fehler: "no mail server set" });
    u.einstellen("b1", { smtp: smtpBei(smtp.port), ruhezeit: null });
    u.uhr.ms += MIN;
    await u.lauf();
    expect(smtp.empfangen).toHaveLength(1);
  });
});

describe("quiet hours", () => {
  it("let a fault out at once and hold a warning until they end", async () => {
    const { u, smtp } = await mitSmtp();
    u.einstellen("b1", { smtp: smtpBei(smtp.port), ruhezeit: { von: "22:00", bis: "07:00" } });
    u.empfaenger("b1", { art: "mail", adresse: "betrieb@betreiber.test", abSchwere: "info" });
    // 23:00 in Berlin on 23 November (UTC+1)
    u.uhr.ms = Date.UTC(2026, 10, 23, 22);
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "server_still",
      schwere: "warn",
      text: "still",
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "stoerung",
      schwere: "fehler",
      text: "kaputt",
    });
    expect(await u.lauf()).toEqual({ angelegt: 2, zugestellt: 1, gescheitert: 0, gehalten: 1 });
    expect(mailInhalt(smtp.empfangen[0]?.daten ?? "").text).toContain("kaputt");
    u.uhr.ms = Date.UTC(2026, 10, 24, 5, 59);
    expect(await u.lauf()).toMatchObject({ zugestellt: 0, gehalten: 1 });
    u.uhr.ms = Date.UTC(2026, 10, 24, 6, 0);
    expect(await u.lauf()).toMatchObject({ zugestellt: 1, gehalten: 0 });
    expect(mailInhalt(smtp.empfangen[1]?.daten ?? "").text).toContain("still");
  });
});

describe("which events reach whom", () => {
  it("goes by each recipient's threshold, a fix by the severity of what it fixes", async () => {
    const u = benachrichtigungsUmgebung();
    const nurStoerungen = empfaenger(u);
    const alles = webhookEmpfaenger(SCHLUESSEL, { jetzt: () => u.uhr.ms });
    stopper.push(alles.stoppen);
    u.empfaenger("b1", {
      art: "webhook",
      url: nurStoerungen.url(),
      schluessel: SCHLUESSEL,
      abSchwere: "fehler",
    });
    u.empfaenger("b1", {
      art: "webhook",
      url: alles.url(),
      schluessel: SCHLUESSEL,
      abSchwere: "info",
    });
    const t = u.uhr.ms;
    ereignisSchreiben(u.schreibDb, "b1", { zeitpunkt: t, art: "pruefung_platte", schwere: "warn" });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 1,
      art: "pruefung_platte",
      schwere: "fehler",
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 2,
      art: "pruefung_platte_behoben",
      schwere: "info",
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 3,
      art: "pruefung_uhr",
      schwere: "warn",
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 4,
      art: "pruefung_uhr_behoben",
      schwere: "info",
    });
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: t + 5,
      art: "backup_gelungen",
      schwere: "info",
    });
    // another operator's fault reaches none of b1's recipients
    ereignisSchreiben(u.schreibDb, "b2", { zeitpunkt: t + 6, art: "stoerung", schwere: "fehler" });
    u.uhr.ms = t + 10;
    await u.lauf();
    const arten = (e: typeof alles) =>
      e.empfangen.map((x) => JSON.parse(x.body).ereignis.art).sort();
    expect(arten(nurStoerungen)).toEqual(["pruefung_platte", "pruefung_platte_behoben"]);
    expect(arten(alles)).toEqual([
      "backup_gelungen",
      "pruefung_platte",
      "pruefung_platte",
      "pruefung_platte_behoben",
      "pruefung_uhr",
      "pruefung_uhr_behoben",
    ]);
    expect(
      JSON.parse(nurStoerungen.empfangen.find((x) => x.body.includes("_behoben"))?.body ?? "{}")
        .text,
    ).toBe("[Behoben] pruefung_platte_behoben auf s1");
  });

  it("is written once however often the loop looks, and never an event older than the recipient", async () => {
    const u = benachrichtigungsUmgebung();
    const e = empfaenger(u);
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms - 1,
      art: "alt",
      schwere: "fehler",
    });
    u.empfaenger("b1", { art: "webhook", url: e.url(), schluessel: SCHLUESSEL, abSchwere: "info" });
    ereignisSchreiben(u.schreibDb, "b1", { zeitpunkt: u.uhr.ms, art: "neu", schwere: "fehler" });
    expect((await u.lauf()).angelegt).toBe(1);
    u.uhr.ms += 23 * 3600 * S;
    expect((await u.lauf()).angelegt).toBe(0);
    expect(e.empfangen.map((x) => JSON.parse(x.body).ereignis.art)).toEqual(["neu"]);
  });

  it("ends a removed recipient's waiting deliveries, through the audit log", async () => {
    const u = benachrichtigungsUmgebung();
    const e = empfaenger(u);
    const r = u.empfaenger("b1", {
      art: "webhook",
      url: e.url(),
      schluessel: SCHLUESSEL,
      abSchwere: "info",
    });
    ereignisSchreiben(u.schreibDb, "b1", { zeitpunkt: u.uhr.ms, art: "x", schwere: "warn" });
    e.scheitern(1);
    await u.lauf();
    const kontext = { betreiberId: "b1", akteur: "test", jetzt: u.uhr.ms, grund: "weg" };
    expect(empfaengerEntfernen(u, { ...kontext, betreiberId: "b2" }, r.empfaengerId)).toBe(false);
    expect(empfaengerEntfernen(u, kontext, r.empfaengerId)).toBe(true);
    expect(zeilen(u)[0]).toMatchObject({ zustand: "aufgegeben", fehler: "recipient removed" });
    u.uhr.ms += 2 * MIN;
    await u.lauf();
    expect(e.empfangen).toHaveLength(1);
    const aktionen = u.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.betreiberId, "b1"))
      .all()
      .map((a) => a.aktion);
    expect(aktionen).toEqual(
      expect.arrayContaining([
        "benachrichtigung.anlegen",
        "benachrichtigung.zustellung",
        "benachrichtigung.empfaenger-entfernen",
      ]),
    );
  });
});

describe("held deliveries", () => {
  /** Webhooks that always arrive, noted by the event's type */
  const gezaehlt = () => {
    const gesendet: string[] = [];
    const versand = {
      mail: async () => ({ ok: true as const }),
      webhook: async (_ziel: unknown, n: { body: string }) => {
        gesendet.push(JSON.parse(n.body).ereignis.art);
        return { ok: true as const };
      },
      ntfy: async () => ({ ok: true as const }),
    };
    return { gesendet, versand };
  };
  const HOOK = { art: "webhook", url: "https://hooks.example/a", schluessel: SCHLUESSEL } as const;
  // 23:00 in Berlin on 23 November (UTC+1), inside quiet hours 22:00–07:00
  const NACHTS = Date.UTC(2026, 10, 23, 22);
  const warnungen = (u: ReturnType<typeof benachrichtigungsUmgebung>, n: number) => {
    for (let i = 0; i < n; i++)
      ereignisSchreiben(u.schreibDb, "b1", {
        zeitpunkt: u.uhr.ms,
        art: "warnung",
        schwere: "warn",
      });
  };

  it("do not keep a fault from going out in quiet hours", async () => {
    const { gesendet, versand } = gezaehlt();
    const u = benachrichtigungsUmgebung(versand);
    u.einstellen("b1", { smtp: null, ruhezeit: { von: "22:00", bis: "07:00" } });
    u.uhr.ms = NACHTS;
    u.empfaenger("b1", { ...HOOK, abSchwere: "info" });
    warnungen(u, 120);
    expect(await u.lauf()).toMatchObject({ angelegt: 120, zugestellt: 0 });
    u.uhr.ms += MIN;
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "stoerung",
      schwere: "fehler",
    });
    await u.lauf();
    expect(gesendet).toEqual(["stoerung"]);
  });

  it("of one operator do not keep another operator's messages back", async () => {
    const { gesendet, versand } = gezaehlt();
    const u = benachrichtigungsUmgebung(versand);
    u.einstellen("b1", { smtp: null, ruhezeit: { von: "22:00", bis: "07:00" } });
    u.uhr.ms = NACHTS;
    u.empfaenger("b1", { ...HOOK, abSchwere: "info" });
    u.empfaenger("b2", { ...HOOK, abSchwere: "info" });
    warnungen(u, 120);
    await u.lauf();
    u.uhr.ms += MIN;
    ereignisSchreiben(u.schreibDb, "b2", {
      zeitpunkt: u.uhr.ms,
      art: "b2_warnung",
      schwere: "warn",
    });
    await u.lauf();
    expect(gesendet).toEqual(["b2_warnung"]);
  });
});
