import { randomUUID } from "node:crypto";
import type { SchreibDb } from "../db/oeffnen.ts";
import { schreiben } from "../modules/audit/index.ts";
import type { Browser } from "./browser.ts";

/*
 * For the tests of reading operations (Z-406): events, servers and jobs written straight through
 * `schreiben`, and reading a list page by page over HTTP as the interface does.
 */

const kontext = (betreiberId: string, jetzt: number) => ({
  betreiberId,
  akteur: "test",
  jetzt,
  grund: "Test",
});

export const ereignisEinfuegen = (
  schreibDb: SchreibDb,
  betreiberId: string,
  teil: { zeitpunkt: number; schwere?: string; art?: string; ziel?: string; text?: string },
) =>
  schreiben(schreibDb, kontext(betreiberId, teil.zeitpunkt), "test.ereignis", (w) =>
    w.einfuegen("ereignisse", {
      betreiberId,
      ereignisId: randomUUID(),
      zeitpunkt: teil.zeitpunkt,
      art: teil.art ?? "test",
      schwere: teil.schwere ?? "info",
      ziel: teil.ziel ?? "server:s1",
      text: teil.text ?? "Test",
    }),
  );

export const serverEinfuegen = (
  schreibDb: SchreibDb,
  betreiberId: string,
  serverId: string,
  teil: { beigetretenAm?: number | null; name?: string } = {},
) =>
  schreiben(schreibDb, kontext(betreiberId, 1), "test.server", (w) =>
    w.einfuegen("server", {
      betreiberId,
      serverId,
      name: teil.name ?? serverId,
      wartungsfenster: JSON.stringify({ tage: [0], von: "03:00", bis: "04:00" }),
      beigetretenAm: teil.beigetretenAm ?? null,
      angelegtVon: "test",
      angelegtAm: 1,
    }),
  );

export const auftragEinfuegen = (
  schreibDb: SchreibDb,
  betreiberId: string,
  serverId: string,
  teil: {
    angelegtAm: number;
    zustand?: "gescheitert" | "bereit" | "erfolgreich";
    installationId?: string;
    aktion?: string;
  },
) =>
  schreiben(schreibDb, kontext(betreiberId, teil.angelegtAm), "test.auftrag", (w) =>
    w.einfuegen("auftraege", {
      betreiberId,
      auftragId: randomUUID(),
      serverId,
      installationId: teil.installationId ?? null,
      aktion: teil.aktion ?? "migrieren",
      app: "probe",
      version: "1.0.0",
      manifestHash: "0".repeat(64),
      manifest: "schema: 1\n".repeat(200),
      signatur: "untrusted comment: test\nRWQ",
      argumente: "{}",
      zeitlimitS: 60,
      zustand: teil.zustand ?? "bereit",
      wartetAuf: "[]",
      ergebnis:
        teil.zustand === "gescheitert" ? JSON.stringify({ ok: false, fehler: "kaputt" }) : null,
      angelegtVon: "test",
      angelegtAm: teil.angelegtAm,
      geaendertAm: teil.angelegtAm,
    }),
  );

type Liste = { eintraege: Record<string, unknown>[]; weiter: string | null };

/**
 * Reads a list page by page; `zwischen` runs after each page, before the next is asked for (new
 * rows arriving meanwhile); returns every entry in the order read
 */
export const alleSeiten = async (
  person: Pick<Browser, "json">,
  pfad: string,
  anzahl: number,
  zwischen: (seite: number) => void = () => {},
) => {
  const gelesen: Record<string, unknown>[] = [];
  let weiter: string | null = null;
  for (let seite = 0; seite < 100; seite += 1) {
    const trenner = pfad.includes("?") ? "&" : "?";
    const ab = weiter ? `&weiter=${encodeURIComponent(weiter)}` : "";
    const { status, daten } = await person.json(`${pfad}${trenner}anzahl=${anzahl}${ab}`);
    if (status !== 200) throw new Error(`${pfad}: ${status}`);
    const liste = daten as Liste;
    gelesen.push(...liste.eintraege);
    zwischen(seite);
    weiter = liste.weiter;
    if (!weiter) return gelesen;
  }
  throw new Error(`${pfad}: no end`);
};
