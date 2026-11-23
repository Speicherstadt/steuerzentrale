/*
 * The address of an installation (docs/plan.md, "Adresse einer Installation (Z-407)"): every
 * customer has a short name, a DNS label of at most 30 characters, unique within its operator; the
 * dialog suggests `<app>.<kuerzel>.<domain>`, the domain being the operator's. Only a host below
 * that domain gets its DNS records from the Zentrale. Pure functions for the Zentrale, the dialog
 * and the demo alike.
 */

/** Lower-case letters, digits and inner hyphens, 1 to 30 characters: a DNS label */
export const KUERZEL = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/;

const KUERZEL_MAX = 30;

const UMLAUTE: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Without its trailing and leading hyphens */
const ohneRandstriche = (text: string) => text.replace(/^-+|-+$/g, "");

/**
 * A short name from a customer's name: umlauts spelled out, accents dropped, every other run of
 * signs one hyphen, cut to 30 characters; `kunde` when nothing is left
 */
export const kuerzelVorschlag = (name: string): string => {
  const klein = name
    .toLowerCase()
    .replace(/[äöüß]/g, (z) => UMLAUTE[z] ?? z)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  const kurz = ohneRandstriche(
    ohneRandstriche(klein.replace(/[^a-z0-9]+/g, "-")).slice(0, KUERZEL_MAX),
  );
  return kurz === "" ? "kunde" : kurz;
};

/** The short name itself when free, else the first `<kuerzel>-<n>` that is, within 30 characters */
export const freiesKuerzel = (kuerzel: string, vergeben: (k: string) => boolean): string => {
  if (!vergeben(kuerzel)) return kuerzel;
  for (let n = 2; ; n++) {
    const zusatz = `-${n}`;
    const neu = `${ohneRandstriche(kuerzel.slice(0, KUERZEL_MAX - zusatz.length))}${zusatz}`;
    if (!vergeben(neu)) return neu;
  }
};

/** `<app>.<kuerzel>.<domain>`, or nothing while the operator has no domain */
export const adresseVorschlag = (
  app: string,
  kuerzel: string,
  domain: string | null | undefined,
): string | undefined => (domain ? `${app}.${kuerzel}.${domain}` : undefined);

/** Whether the host is a name below the domain (not the domain itself); DNS ignores case */
export const unterDomain = (host: string, domain: string | null | undefined): boolean =>
  !!domain && host.toLowerCase().endsWith(`.${domain.toLowerCase()}`);
