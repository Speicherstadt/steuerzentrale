import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the setup project leaves for the other tests: the first owner's session (inhaber.json, the
 * storageState of desktop and phone) and its sign-in with password and TOTP key
 */
const daten = () => {
  const ordner = process.env.SZ_E2E_DATEN;
  if (!ordner) throw new Error("SZ_E2E_DATEN is not set (playwright.config.ts)");
  return ordner;
};

export const PASSWORT = "lang-genug-und-geheim-1";
export const INHABER_EMAIL = "ines@betreiber.test";

export const sitzungsDatei = () => join(daten(), "inhaber.json");
export const zugangsDatei = () => join(daten(), "inhaber-totp.json");

/** The setup code from the Zentrale's log, written once at its start */
export const einrichtungscode = (): string => {
  const zeile = readFileSync(join(daten(), "zentrale.log"), "utf8")
    .split("\n")
    .find((z) => z.includes("setup code for the first owner"));
  if (!zeile) throw new Error("no setup code in the Zentrale's log");
  return (JSON.parse(zeile) as { code: string }).code;
};

/** The base32 TOTP key of the first owner, as the setup page showed it */
export const totpSchluesselDesInhabers = (): string =>
  (JSON.parse(readFileSync(zugangsDatei(), "utf8")) as { geheimnis: string }).geheimnis;
