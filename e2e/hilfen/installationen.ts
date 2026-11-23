import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect } from "@playwright/test";
import { geheimenSchluesselLesen, signieren } from "../../scripts/minisign.ts";
import { agentVerbinden, type TestAgent } from "./agent.ts";
import { kundeAnlegen } from "./kunden.ts";

/*
 * The signed manifest of the e2e tests of installing (BAULISTE.md Z-402), signed at test time with
 * the public test key (test/schluessel/; docs/plan.md, "Signaturen in Tests"), whose public half
 * playwright.config.ts hands the Zentrale as `minisign.pub`. After the Zentrale's own test
 * manifest (apps/zentrale/src/testhilfen/manifeste/probe.yml), without a required value of the
 * operator; `mitBetreiberwert` gives it one under an app id of its own (Z-404), so the dialog asks
 * for it in each run of the test, on desktop and phone alike.
 */
const PROBE = `schema: 1
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
  - { name: PROBE_KENNWORT, ebene: installation, typ: geheim }
  - { name: PROBE_LIMIT, ebene: installation, typ: zahl, vorgabe: 5 }
  - { name: PROBE_OFFEN, ebene: installation, typ: ja_nein, vorgabe: false }
  - { name: PROBE_EXTRA, ebene: installation, option: extra }
`;

const REPO = join(import.meta.dirname, "../..");

/** The probe manifest under the app id `app` with a required secret of the operator */
export const mitBetreiberwert = (app: string) =>
  PROBE.replace("id: probe", `id: ${app}`).replace(
    "env:\n",
    "env:\n  - { name: PROBE_LIZENZ, ebene: betreiber, typ: geheim, pflicht: true }\n",
  );

/** The probe manifest without the restart (Z-405): the page must not offer it */
export const ohneNeustart = () =>
  PROBE.replace(
    "aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }",
    "aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt, neustart: nicht_unterstuetzt }",
  );

/** The manifest's text and signature */
export const signiertesManifest = (text = PROBE) => {
  const schluessel = geheimenSchluesselLesen(
    readFileSync(join(REPO, "test/schluessel/test.key"), "utf8"),
  );
  return {
    manifest: text,
    signatur: signieren(new TextEncoder().encode(text), schluessel, "probe 1.0.0 (test key)"),
  };
};

/** Both as files to upload in the dialog, in the tests' own directory */
export const manifestDateien = (text = PROBE) => {
  const ordner = join(process.env.SZ_E2E_DATEN ?? "", `manifest-${randomUUID().slice(0, 8)}`);
  mkdirSync(ordner, { recursive: true });
  const { manifest, signatur } = signiertesManifest(text);
  const pfad = join(ordner, "manifest.yml");
  writeFileSync(pfad, manifest);
  writeFileSync(`${pfad}.minisig`, signatur);
  return { manifest: pfad, signatur: `${pfad}.minisig` };
};

/** A host no other test uses; `kaputt…` makes the stand-in agent fail the setup */
export const neuerHost = (vorne = "probe") => `${vorne}-${randomUUID().slice(0, 8)}.kunde.test`;

export type Angelegt = {
  installationId: string;
  host: string;
  kunde: { id: string; name: string };
  agent: TestAgent;
};

/**
 * An installation made over the API for a new customer on a new server with a connected agent,
 * from the probe manifest or `text`
 */
export const installationAnlegen = async (
  request: APIRequestContext,
  host = neuerHost(),
  text = PROBE,
): Promise<Angelegt> => {
  const kunde = await kundeAnlegen(request, "Kanzlei Nord");
  const agent = await agentVerbinden(request, "Gemeinsamer Server");
  const antwort = await request.post("/api/v1/installationen", {
    data: {
      kundeId: kunde.id,
      serverId: agent.serverId,
      ...signiertesManifest(text),
      optionen: [],
      host,
      einstellungen: { PROBE_KENNWORT: "kennwort-der-installation" },
      grund: "Test",
    },
  });
  expect(antwort.status()).toBe(201);
  const { installationId } = (await antwort.json()) as { installationId: string };
  return { installationId, host, kunde, agent };
};
