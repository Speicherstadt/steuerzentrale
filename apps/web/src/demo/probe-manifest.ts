/**
 * A manifest for the tests of the dialog "Installieren" (Z-402), after the Zentrale's test manifest
 * apps/zentrale/src/testhilfen/manifeste/probe.yml: one setting of every type on the level
 * `installation`, one only with an option, and no required value of the operator, so it fits a
 * demo server. The demo checks no signature, so any text stands in for the .minisig.
 */
export const PROBE_MANIFEST = `schema: 1
id: probe
version: 1.0.0
lizenz: AGPL-3.0-only
quelle: https://example.org/probe
container:
  - name: app
    image: registry.example.org/probe@sha256:1111111111111111111111111111111111111111111111111111111111111111
    env: [PROBE_TITEL, PROBE_KENNWORT, PROBE_LIMIT, PROBE_OFFEN, PROBE_EXTRA]
architektur: [amd64, arm64]
ressourcen: { ram_mb: 256, platte_gb: 1 }
netz: { http: { dienst: app, port: 8080 } }
optionen: [{ id: extra, name: Zusatzdienst }]
anmeldung: eigen
health: { art: http, dienst: app, pfad: /health }
aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }
env:
  - { name: PROBE_TITEL, ebene: installation, vorgabe: Probe, beschreibung: Titel der Seite }
  - { name: PROBE_KENNWORT, ebene: installation, typ: geheim, pflicht: true }
  - { name: PROBE_LIMIT, ebene: installation, typ: zahl, vorgabe: 5 }
  - { name: PROBE_OFFEN, ebene: installation, typ: ja_nein, vorgabe: false }
  - { name: PROBE_EXTRA, ebene: installation, option: extra }
`;

export const PROBE_SIGNATUR = "untrusted comment: demo\nRUR...\n";

/** The probe app's next version as a pre-release: offered only to an internal customer (Z-501) */
export const PROBE_VORAB = PROBE_MANIFEST.replace("version: 1.0.0", "version: 1.1.0-rc.1");
