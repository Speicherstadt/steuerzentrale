import { BACKUP_FRIST_MS } from "@steuerzentrale/planung";
import type { InstallationsAngebot } from "./apps.ts";
import type { BackupZeile } from "./backups.ts";
import type { HealthGrund } from "./bewertung.ts";
import type { InstallationAnsicht } from "./installation-ansicht.ts";

/*
 * The table of the page "Apps" as data (docs/plan.md, "Navigation (Oberfläche 2026-11)"): per app
 * its state in plain words, from the setup, the agent's rating (Z-403), the backups (Z-601, Z-602)
 * and the update under way (Z-503), each from its source and nothing invented; what needs
 * attention first; the filters "Alle", "Braucht dich" and "Update möglich"; grouped by nothing, by
 * customer or by server. A removed installation is no longer listed.
 */

/** What the column "Zustand" says, the most pressing first */
export type AppZustand =
  | { art: "gescheitert" }
  | { art: "stoerung"; grund: HealthGrund }
  | { art: "backup_alt"; tage: number }
  | { art: "backup_gescheitert" }
  | { art: "pruef_gescheitert" }
  | { art: "warnung"; grund: HealthGrund }
  | { art: "unbekannt"; grund: HealthGrund }
  | { art: "wird_eingerichtet" }
  | { art: "aktualisiert" }
  | { art: "laeuft" };

/** How urgent: red, yellow and unknown need someone; a setup or an update is on its way */
export type Stufe = "rot" | "gelb" | "unbekannt" | "unterwegs" | "gut";

const STUFE: Record<AppZustand["art"], Stufe> = {
  gescheitert: "rot",
  stoerung: "rot",
  backup_alt: "gelb",
  backup_gescheitert: "gelb",
  pruef_gescheitert: "gelb",
  warnung: "gelb",
  unbekannt: "unbekannt",
  wird_eingerichtet: "unterwegs",
  aktualisiert: "unterwegs",
  laeuft: "gut",
};

const RANG: Record<Stufe, number> = { rot: 0, gelb: 1, unbekannt: 2, unterwegs: 3, gut: 4 };

export const stufeVon = (z: AppZustand): Stufe => STUFE[z.art];

const TAG_MS = 86_400_000;

/** The version an update under way goes to, or null: by hand (Z-503), or in a wave of the demo */
export const updateZiel = (
  a: InstallationAnsicht,
  angebot: InstallationsAngebot | undefined,
): string | null => {
  if (angebot?.update.laeuft)
    return angebot.update.letzter?.nachVersion ?? angebot.angeboten[0]?.version ?? null;
  return a.demo?.updateLaeuft ? (angebot?.angeboten[0]?.version ?? null) : null;
};

/** The newest version offered while no update runs, for the mark "↑" and the filter */
export const angeboteneVersion = (
  a: InstallationAnsicht,
  angebot: InstallationsAngebot | undefined,
): string | null =>
  updateZiel(a, angebot) === null ? (angebot?.angeboten[0]?.version ?? null) : null;

const backupZustand = (b: BackupZeile | undefined, jetzt: number): AppZustand | null => {
  if (!b) return null;
  if (b.letzterErfolg !== null && jetzt - b.letzterErfolg > BACKUP_FRIST_MS)
    return { art: "backup_alt", tage: Math.floor((jetzt - b.letzterErfolg) / TAG_MS) };
  if (b.letzter && !b.letzter.ok) return { art: "backup_gescheitert" };
  if (b.pruefRestore.letzter?.ok === false && !b.pruefRestore.laeuft)
    return { art: "pruef_gescheitert" };
  return null;
};

/** The state in one: the setup until it runs, a fault, then backups, warnings, an update */
export const appZustand = (
  a: InstallationAnsicht,
  backup: BackupZeile | undefined,
  angebot: InstallationsAngebot | undefined,
  jetzt: number,
): AppZustand => {
  if (a.zustand === "gescheitert") return { art: "gescheitert" };
  if (a.zustand !== "laeuft") return { art: "wird_eingerichtet" };
  const h = a.health;
  if (h.zustand === "rot") return { art: "stoerung", grund: h.grund };
  const b = backupZustand(backup, jetzt);
  if (b) return b;
  if (h.zustand === "gelb") return { art: "warnung", grund: h.grund };
  if (h.zustand === "unbekannt") return { art: "unbekannt", grund: h.grund };
  return updateZiel(a, angebot) === null ? { art: "laeuft" } : { art: "aktualisiert" };
};

export type AppZeile = {
  a: InstallationAnsicht;
  zustand: AppZustand;
  stufe: Stufe;
  /** The version an update under way goes to */
  ziel: string | null;
  /** The newest version offered, while no update runs */
  angeboten: string | null;
  /** The newest successful backup, and whether it is older than the checks allow */
  backup: { zeitpunkt: number; alt: boolean } | null;
};

export type ListenDaten = {
  installationen: InstallationAnsicht[];
  backups: BackupZeile[];
  angebote: InstallationsAngebot[];
  jetzt: number;
};

const zeileVon = (d: ListenDaten, a: InstallationAnsicht): AppZeile => {
  const backup = d.backups.find((b) => b.installationId === a.id);
  const angebot = d.angebote.find((x) => x.installationId === a.id);
  const zustand = appZustand(a, backup, angebot, d.jetzt);
  const erfolg = backup?.letzterErfolg ?? null;
  return {
    a,
    zustand,
    stufe: stufeVon(zustand),
    ziel: updateZiel(a, angebot),
    angeboten: angeboteneVersion(a, angebot),
    backup: erfolg === null ? null : { zeitpunkt: erfolg, alt: d.jetzt - erfolg > BACKUP_FRIST_MS },
  };
};

/** Every app not removed, what needs attention first, else in the order the Zentrale lists them */
export const appZeilen = (d: ListenDaten): AppZeile[] =>
  d.installationen
    .filter((a) => a.zustand !== "entfernt")
    .map((a) => zeileVon(d, a))
    .map((z, n) => ({ z, n }))
    .sort((x, y) => RANG[x.z.stufe] - RANG[y.z.stufe] || x.n - y.n)
    .map(({ z }) => z);

export type Filter = "alle" | "braucht" | "update";

export const FILTER: Filter[] = ["alle", "braucht", "update"];

const BRAUCHT: Stufe[] = ["rot", "gelb", "unbekannt"];

export const passt = (z: AppZeile, filter: Filter): boolean =>
  filter === "alle" || (filter === "braucht" ? BRAUCHT.includes(z.stufe) : z.angeboten !== null);

/** App, customer, address or server contains the query, ignoring case */
export const gefunden = (z: AppZeile, frage: string): boolean => {
  const q = frage.trim().toLowerCase();
  if (!q) return true;
  return [z.a.appName, z.a.kundeName, z.a.host, z.a.serverName].some((t) =>
    t.toLowerCase().includes(q),
  );
};

export const gefiltert = (zeilen: AppZeile[], filter: Filter, frage: string): AppZeile[] =>
  zeilen.filter((z) => passt(z, filter) && gefunden(z, frage));

export type Gruppierung = "nicht" | "kunde" | "server";

export type Gruppe = { art: "kunde" | "server"; id: string; name: string; zeilen: AppZeile[] };

/**
 * The rows under their customer or server, each group where its first row stands, so the group
 * with the most pressing app comes first
 */
export const gruppiert = (zeilen: AppZeile[], nach: Exclude<Gruppierung, "nicht">): Gruppe[] => {
  const schluessel = (z: AppZeile) =>
    nach === "kunde"
      ? { id: z.a.kundeId, name: z.a.kundeName }
      : { id: z.a.serverId, name: z.a.serverName };
  const ids = [...new Set(zeilen.map((z) => schluessel(z).id))];
  return ids.map((id) => {
    const eigene = zeilen.filter((z) => schluessel(z).id === id);
    return { art: nach, id, name: eigene[0] ? schluessel(eigene[0]).name : id, zeilen: eigene };
  });
};
