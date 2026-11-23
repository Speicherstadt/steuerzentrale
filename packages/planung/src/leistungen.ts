import {
  imMonat,
  type Monat,
  type MonatsVerfuegbarkeit,
  monatsGrenzen,
  verfuegbarkeitImMonat,
  type Zeitscheibe,
} from "./verfuegbarkeit.ts";

/*
 * What each customer used in a month (BAULISTE.md Z-804; docs/plan.md, "Leistungen"), summed from
 * what happened, never from a counter kept beside it: installations from the end of their setup,
 * storage from the newest successful backup run, support time from the support accesses,
 * availability from the checks from outside (verfuegbarkeit.ts). A month is a calendar month in
 * Europe/Berlin, as invoices count it.
 */

type Grenzen = { von: number; bis: number };

export type LeistungsKunde = {
  kundeId: string;
  /** Our own customer (Z-501): nothing to account for */
  intern: boolean;
  vertragBeginn: number;
  vertragEnde: number | null;
};

/** An installation whose setup succeeded, since when it runs */
export type LeistungsInstallation = {
  installationId: string;
  kundeId: string;
  app: string;
  laeuftSeit: number;
};

/** A backup run with the size restic read for each part (`bytes`, Z-804), if the agent said */
export type LeistungsBackup = {
  installationId: string;
  zeitpunkt: number;
  ok: boolean;
  teile: { bytes?: number | undefined }[];
};

export type LeistungsZugang = { kundeId: string; beginn: number; endetAm: number };

export type LeistungsEingaben = {
  kunden: LeistungsKunde[];
  installationen: LeistungsInstallation[];
  scheiben: (Zeitscheibe & { installationId: string })[];
  backups: LeistungsBackup[];
  zugaenge: LeistungsZugang[];
};

export type InstallationsLeistung = {
  installationId: string;
  app: string;
  speicherBytes: number | null;
  verfuegbarkeit: MonatsVerfuegbarkeit;
};

export type KundenLeistung = {
  kundeId: string;
  installationen: InstallationsLeistung[];
  /** The known sizes of its installations together; null when none is known */
  speicherBytes: number | null;
  supportMinuten: number;
  /** The worst installation's share; measured minutes of all together */
  verfuegbarkeit: { minuten: number; gemessen: number; anteil: number | null };
};

/** "2026-11" as a month; anything else is no month */
export const monatAusText = (text: string): Monat | undefined => {
  const treffer = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  return treffer ? { jahr: Number(treffer[1]), monat: Number(treffer[2]) } : undefined;
};

export const monatText = (m: Monat): string => `${m.jahr}-${String(m.monat).padStart(2, "0")}`;

/**
 * Minutes of support a customer got: each access in the month it began, as long as it ran or has
 * run so far; minutes rounded per access, as the customer page shows them
 */
export const supportMinutenImMonat = (
  zugaenge: readonly LeistungsZugang[],
  kundeId: string,
  g: Grenzen,
  jetzt: number,
): number =>
  zugaenge
    .filter((z) => z.kundeId === kundeId && imMonat(z.beginn, g))
    .reduce(
      (summe, z) =>
        summe + Math.round((Math.max(z.beginn, Math.min(z.endetAm, jetzt)) - z.beginn) / 60_000),
      0,
    );

/**
 * The size of an installation's data: the bytes restic read in the newest successful run of the
 * month, all parts together; unknown without such a run or when a part carries no size
 */
export const speicherImMonat = (
  backups: readonly LeistungsBackup[],
  installationId: string,
  g: Grenzen,
): number | null => {
  const neuester = backups
    .filter((b) => b.installationId === installationId && b.ok && imMonat(b.zeitpunkt, g))
    .reduce<LeistungsBackup | undefined>(
      (best, b) => (best === undefined || b.zeitpunkt > best.zeitpunkt ? b : best),
      undefined,
    );
  if (!neuester || neuester.teile.some((t) => t.bytes === undefined)) return null;
  return neuester.teile.reduce((summe, t) => summe + (t.bytes ?? 0), 0);
};

const vertragImMonat = (k: LeistungsKunde, g: Grenzen): boolean =>
  !k.intern && k.vertragBeginn < g.bis && (k.vertragEnde === null || k.vertragEnde >= g.von);

const kundenVerfuegbarkeit = (
  installationen: InstallationsLeistung[],
  minuten: number,
): KundenLeistung["verfuegbarkeit"] => {
  const anteile = installationen
    .map((i) => i.verfuegbarkeit.anteil)
    .filter((a): a is number => a !== null);
  return {
    minuten,
    gemessen: installationen.reduce((summe, i) => summe + i.verfuegbarkeit.gemessen, 0),
    anteil: anteile.length === 0 ? null : Math.min(...anteile),
  };
};

const summeBekannter = (werte: (number | null)[]): number | null => {
  const bekannt = werte.filter((w): w is number => w !== null);
  return bekannt.length === 0 ? null : bekannt.reduce((summe, w) => summe + w, 0);
};

/** The services of each customer whose contract ran in the month, in the order of `kunden` */
export const leistungenImMonat = (
  e: LeistungsEingaben,
  m: Monat,
  jetzt: number,
): KundenLeistung[] => {
  const g = monatsGrenzen(m);
  const minuten = verfuegbarkeitImMonat([], m, jetzt).minuten;
  return e.kunden
    .filter((k) => vertragImMonat(k, g))
    .map((k) => {
      const installationen = e.installationen
        .filter((i) => i.kundeId === k.kundeId && i.laeuftSeit < g.bis)
        .map((i) => ({
          installationId: i.installationId,
          app: i.app,
          speicherBytes: speicherImMonat(e.backups, i.installationId, g),
          verfuegbarkeit: verfuegbarkeitImMonat(
            e.scheiben.filter((s) => s.installationId === i.installationId),
            m,
            jetzt,
          ),
        }));
      return {
        kundeId: k.kundeId,
        installationen,
        speicherBytes: summeBekannter(installationen.map((i) => i.speicherBytes)),
        supportMinuten: supportMinutenImMonat(e.zugaenge, k.kundeId, g, jetzt),
        verfuegbarkeit: kundenVerfuegbarkeit(installationen, minuten),
      };
    });
};
