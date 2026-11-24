import type { MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import { getLocale, m } from "@steuerzentrale/ui";
import type { InstallationsAngebot } from "../daten/apps.ts";
import { updateZiel } from "../daten/apps-liste.ts";
import {
  type AussenDerZentrale,
  aussenGrundText,
  prozentVon,
  ZIEL_PROZENT,
} from "../daten/aussen.ts";
import type { BackupLauf } from "../daten/backups.ts";
import type { InstallationAnsicht } from "../daten/installation-ansicht.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import { gbAusBytes, prozent } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { agentText } from "./server-texte.ts";

/*
 * The lines of the tab "Überblick" as text, from the data each row reads; a row says what it does
 * not know rather than guess.
 */

/** Where the app's version stands: an update under way, one offered, current, or not known */
export type Versionsstand =
  | { art: "laeuft"; ziel: string | null }
  | { art: "angeboten"; angebot: InstallationsAngebot; version: string }
  | { art: "aktuell" }
  | { art: "unbekannt" };

export const versionsstand = (
  a: InstallationAnsicht,
  angebot: InstallationsAngebot | undefined,
): Versionsstand => {
  const ziel = updateZiel(a, angebot);
  if (ziel !== null || angebot?.update.laeuft) return { art: "laeuft", ziel };
  if (!angebot) return { art: "unbekannt" };
  const neu = angebot.angeboten[0];
  return neu ? { art: "angeboten", angebot, version: neu.version } : { art: "aktuell" };
};

export const versionText = (s: Versionsstand): string => {
  switch (s.art) {
    case "laeuft":
      return s.ziel ? m.app_version_update_laeuft({ version: s.ziel }) : m.apps_z_aktualisiert();
    case "angeboten":
      return m.app_version_angeboten({ version: s.version });
    case "aktuell":
      return m.app_version_aktuell();
    case "unbekannt":
      return m.app_version_unbekannt();
  }
};

/** The check from outside: its time and the certificate's end when green, else why not */
export const aussenZeile = (
  a: AussenDerZentrale | null,
  jetzt: number,
): { text: string; ok: boolean | null } => {
  if (!a) return { text: m.aussen_noch_nicht(), ok: null };
  if (a.zustand !== "gruen")
    return { text: aussenGrundText(a.grund), ok: a.zustand === "unbekannt" ? null : false };
  const http = a.ergebnis.http;
  const tls = a.ergebnis.tls;
  const teile = [
    http?.ok ? m.app_antwortet({ ms: String(http.ms) }) : aussenGrundText(a.grund),
    tls?.ok && tls.gueltigBis > jetzt
      ? m.app_zertifikat_bis({ datum: datum(tls.gueltigBis) })
      : null,
  ];
  return { text: teile.filter(Boolean).join(" · "), ok: true };
};

/** The newest run: when, how big, that it runs every night, and the newest test restore */
export const backupZeile = (
  lauf: BackupLauf | null,
  bytes: number | null,
  pruef: string,
  jetzt: number,
): { titel: string; text: string } => {
  // the timer of every app's backup runs daily (packages/manifest, backup/units.ts, OnCalendar)
  const teile = [
    bytes === null ? null : gbAusBytes(bytes),
    m.app_backup_jede_nacht(),
    m.app_backup_pruef({ stand: pruef }),
  ];
  const text = teile.filter(Boolean).join(" · ");
  if (!lauf) return { titel: m.app_backup_keins(), text };
  const zeit = zeitpunkt(lauf.zeitpunkt, jetzt);
  return {
    titel: lauf.ok ? m.app_backup_titel({ zeit }) : m.app_backup_gescheitert_titel({ zeit }),
    text,
  };
};

const monatsName = (v: Pick<MonatsVerfuegbarkeit, "jahr" | "monat">) =>
  new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(Date.UTC(v.jahr, v.monat - 1, 15));

/** "November 100 % · Oktober 99,98 %": this month and the last, as far as measured */
export const monateText = (monate: MonatsVerfuegbarkeit[]): string => {
  const gemessen = monate.slice(0, 2).filter((v) => v.anteil !== null);
  if (gemessen.length === 0) return m.aussen_nicht_gemessen();
  return gemessen
    .map((v) => `${monatsName(v)} ${prozent(prozentVon(v) ?? 0, prozentVon(v) === 100 ? 0 : 2)}`)
    .join(" · ");
};

/** Whether this and the last month reach the SLA's mark; null without a measurement */
export const monateOk = (monate: MonatsVerfuegbarkeit[]): boolean | null => {
  const gemessen = monate.slice(0, 2).filter((v) => v.anteil !== null);
  if (gemessen.length === 0) return null;
  return gemessen.every((v) => (prozentVon(v) ?? 0) >= ZIEL_PROZENT);
};

/** The server's connection and what its facts say of memory and disk */
export const serverZeile = (s: ServerAnsicht | undefined, jetzt: number): string => {
  if (!s) return m.app_server_unbekannt();
  return [
    agentText({ jetzt }, s),
    s.ramGb === null ? null : m.app_server_ram({ gb: String(s.ramGb) }),
    s.platte === null ? null : m.app_server_platte({ prozent: prozent(s.platte) }),
  ]
    .filter(Boolean)
    .join(" · ");
};
