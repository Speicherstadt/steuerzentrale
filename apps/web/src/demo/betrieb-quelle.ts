import type { Antwort } from "../anmeldung/api.ts";
import type {
  AuditEintragDerZentrale,
  AuftragDerZentrale,
  BetriebQuelle,
  EreignisDerZentrale,
  Ereignisschwere,
  Seite,
  ZielVerweis,
} from "../daten/betrieb.ts";
import type { AuftragsZustand } from "../daten/installationen.ts";
import type { Auftrag, AuftragZustand, Schwere, Ziel } from "../daten/typen.ts";
import { demoUebersicht } from "./betrieb-uebersicht.ts";
import { installationen } from "./installationen.ts";
import { kunden } from "./kunden.ts";
import { server } from "./server.ts";
import { audit, auftraege, ereignisse, konten } from "./vorgaenge.ts";

/*
 * The demo's jobs, events and audit log as the Zentrale's API lists them (BAULISTE.md Z-406):
 * targets written `art:id`, the states and severities of the Zentrale, page by page with a cursor,
 * so `bun run dev:demo`, the screenshots and the component tests see what a signed-in person sees.
 */

/** How many rows a demo page holds: small, so "Mehr laden" shows in the demo too */
export const DEMO_SEITE = 20;

const ok = <T>(daten: T): Antwort<T> => ({ ok: true, status: 200, daten });

/** A page from the cursor on: the cursor is the index of the next row */
export const seiteAus = <T>(alle: T[], weiter?: string, groesse = DEMO_SEITE): Seite<T> => {
  const ab = weiter ? Number(weiter) : 0;
  const ende = ab + groesse;
  return { eintraege: alle.slice(ab, ende), weiter: ende < alle.length ? String(ende) : null };
};

export const zielText = (z: Ziel): string =>
  z.art === "einstellungen" ? "einstellungen" : `${z.art}:${z.id}`;

const kundeName = (id: string) => kunden.find((k) => k.id === id)?.name ?? id;

/** The page and name of a demo target, as the Zentrale names its own (modules/betrieb/ziele.ts) */
export const demoVerweis = (z: Ziel): ZielVerweis | null => {
  if (z.art === "installation") {
    const i = installationen.find((x) => x.id === z.id);
    return i ? { art: "installation", id: i.id, name: `${kundeName(i.kunde)} · ${i.app}` } : null;
  }
  if (z.art === "server") {
    const s = server.find((x) => x.id === z.id);
    return s ? { art: "server", id: s.id, name: s.name } : null;
  }
  return null;
};

const SCHWERE: Record<Schwere, Ereignisschwere> = { krit: "fehler", warn: "warn", info: "info" };

export const demoEreignisse: EreignisDerZentrale[] = ereignisse.map((e, n) => ({
  ereignisId: `E-${n + 1}`,
  zeitpunkt: e.zeit,
  art: "demo",
  schwere: SCHWERE[e.schwere],
  ziel: zielText(e.ziel),
  verweis: demoVerweis(e.ziel),
  text: e.text,
}));

const ZUSTAND: Record<AuftragZustand, AuftragsZustand> = {
  wartet: "wartend",
  geplant: "wartend",
  laeuft: "laeuft",
  fertig: "erfolgreich",
  gescheitert: "gescheitert",
};

/** The demo's actions as named commands; a restart is the built-in job of Z-405 */
const AKTION: Record<Auftrag["aktion"], string> = {
  update: "update",
  neustart: "installation_neustart",
  neustart_server: "neustart_server",
  pruef_restore: "pruef_restore",
  backup: "backup",
};

const demoAuftrag = (a: Auftrag): AuftragDerZentrale => {
  const z = a.ziel;
  const i = z.art === "installation" ? installationen.find((x) => x.id === z.id) : undefined;
  const sid = i?.server ?? (z.art === "server" ? z.id : "");
  return {
    auftragId: a.id,
    aktion: AKTION[a.aktion],
    app: i?.app ?? "",
    version: a.version ?? i?.version ?? "",
    zustand: ZUSTAND[a.zustand],
    fortschritt: a.zustand === "gescheitert" ? null : a.schritt,
    fehler: a.zustand === "gescheitert" ? a.schritt : null,
    server: { serverId: sid, name: server.find((s) => s.id === sid)?.name ?? sid },
    installation: i ? { installationId: i.id, host: i.adresse, kunde: kundeName(i.kunde) } : null,
    angelegtVon: "system",
    angelegtAm: a.start,
    geaendertAm: a.start,
  };
};

export const demoAuftraege: AuftragDerZentrale[] = auftraege
  .map(demoAuftrag)
  .sort((x, y) => y.angelegtAm - x.angelegtAm);

const demoAudit: AuditEintragDerZentrale[] = audit.map((e, n) => ({
  nummer: audit.length - n,
  zeitpunkt: e.zeit,
  akteur: e.akteur
    ? {
        art: "person",
        id: `konto-${konten.findIndex((k) => k.name === e.akteur?.name)}`,
        name: e.akteur.name,
      }
    : { art: "zentrale", id: "system" },
  aktion: e.aktion,
  ziel: zielText(e.ziel),
  verweis: demoVerweis(e.ziel),
  grund: e.grund,
  inhalt: null,
}));

const passt = <T>(werte: T[] | undefined, wert: T) => !werte?.length || werte.includes(wert);

export const demoBetrieb = (): BetriebQuelle => ({
  uebersicht: async () => ok(demoUebersicht(demoAuftraege, demoEreignisse)),
  auftraege: async (f, weiter) =>
    ok(
      seiteAus(
        demoAuftraege.filter(
          (a) =>
            passt(f.zustand, a.zustand) &&
            passt(f.serverId, a.server.serverId) &&
            passt(f.installationId, a.installation?.installationId ?? ""),
        ),
        weiter,
      ),
    ),
  ereignisse: async (f, weiter) =>
    ok(
      seiteAus(
        demoEreignisse.filter(
          (e) => passt(f.schwere, e.schwere) && passt(f.art, e.art) && passt(f.ziel, e.ziel),
        ),
        weiter,
      ),
    ),
  audit: async (f, weiter) =>
    ok(
      seiteAus(
        demoAudit.filter(
          (e) => passt(f.akteur, e.akteur.id) && passt(f.aktion, e.aktion) && passt(f.ziel, e.ziel),
        ),
        weiter,
      ),
    ),
});
