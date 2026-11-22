import { AKTIONS_AUFTRAEGE, type Einrichtung } from "@steuerzentrale/manifest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { EINRICHTUNG, einrichtenAuftrag, MANIFEST } from "../src/einrichtung/testauftraege.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";

/*
 * The jobs of the unit tests of restart and log excerpt (Z-405): the manifest of the setup tests
 * (src/einrichtung/testauftraege.ts) with its key as a generated value of ebene `auto` that is no
 * secret, so it stands as Environment= in the unit, and a password of typ `geheim`, which becomes
 * a Podman secret; signed here with the public test key (test/schluessel/), so each test may
 * change the manifest (an action not offered, another version).
 */

/** The generated value, as base64 has it */
export const AUTO = "auto+Zufall/AbC123==";
/** The password, a Podman secret */
export const PASSWORT = "pw-streng-geheim-4711";

/** The manifest with both settings, its version and its `aktionen` line replaced when given */
export const aktionsManifest = (aktionen?: string, version = "1.0.0"): string => {
  let text = ersetzen(
    MANIFEST,
    "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]",
    "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL, BEISPIEL_PASSWORT]",
  );
  text = ersetzen(
    text,
    "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32, typ: geheim }",
    [
      "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32 }",
      "  - { name: BEISPIEL_PASSWORT, ebene: installation, typ: geheim }",
    ].join("\n"),
  );
  text = ersetzen(text, 'version: "1.0.0"', `version: "${version}"`);
  return aktionen === undefined
    ? text
    : ersetzen(
        text,
        "aktionen: { nur_lesen: nicht_unterstuetzt, export: { befehl: export } }",
        `aktionen: ${aktionen}`,
      );
};

export const AKTIONS_EINRICHTUNG: Einrichtung = {
  ...EINRICHTUNG,
  einstellungen: {
    betreiber: {},
    installation: { BEISPIEL_PASSWORT: PASSWORT },
    auto: { BEISPIEL_SCHLUESSEL: AUTO },
  },
};

/** Setting up with the manifest of the actions */
export const aktionsEinrichtung = (manifest = aktionsManifest()): AuftragNachricht =>
  einrichtenAuftrag({ manifest, signatur: signiert(manifest), einrichtung: AKTIONS_EINRICHTUNG });

/** A restart or log excerpt of the installation, with the manifest given */
export const aktionsAuftrag = (
  art: keyof typeof AKTIONS_AUFTRAEGE,
  teil: Partial<AuftragNachricht> = {},
  manifest = aktionsManifest(),
): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: `${art}-1`,
    aktion: AKTIONS_AUFTRAEGE[art],
    manifest,
    signatur: signiert(manifest),
    zeitlimitS: 60,
    einrichtung: undefined,
    ...teil,
  });
