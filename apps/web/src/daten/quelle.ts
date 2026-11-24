import { apps } from "../demo/apps.ts";
import { demo } from "../demo/index.ts";
import type { Bestand } from "./typen.ts";

/*
 * The demo fixtures of src/demo/ for what has no API yet (BAULISTE.md Z-406; docs/plan.md, "Echte
 * Daten (Z-406)"). In `bun run dev:demo` and the component tests they are the whole demo operator;
 * once someone is signed in, main.tsx puts in `ohneDemo`: no server, installation, customer, job,
 * event or access of the demo, only the descriptions of the apps (src/demo/apps.ts) (until the
 * Zentrale imports manifests, Z-501), so no page shows a made-up datum beside real ones. The pages
 * read servers, installations, customers, jobs, events and the audit log from their sources.
 */

/** Nothing of the demo operator; `jetzt` is the clock's, not the demo's fixed morning */
export const ohneDemo: Bestand = {
  get jetzt() {
    return Date.now();
  },
  betreiber: {
    name: "",
    domain: "",
    werte: {},
    geheimGesetzt: [],
    s3: "",
  },
  konto: { name: "", rolle: "support", faktor: "passkey", zuletzt: 0 },
  apps,
  server: [],
  kunden: [],
  installationen: [],
  ereignisse: [],
  auftraege: [],
  zugaenge: [],
  audit: [],
  konten: [],
  plaene: [],
  agentVersion: "",
};

let aktuell: Bestand = demo;

export const bestand = (): Bestand => aktuell;

/** Whether the pages show the demo operator (`dev:demo`, screenshots, component tests) */
export const mitDemo = (): boolean => aktuell === demo;

export const bestandEinsetzen = (neu: Bestand): void => {
  aktuell = neu;
};
