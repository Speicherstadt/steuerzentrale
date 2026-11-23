import type { Bestand } from "../daten/typen.ts";
import { apps } from "./apps.ts";
import { installationen } from "./installationen.ts";
import { kunden } from "./kunden.ts";
import { server } from "./server.ts";
import { audit, auftraege, ereignisse, konten, zugaenge } from "./vorgaenge.ts";
import { berlin, JETZT } from "./zeit.ts";

/**
 * The demo operator "Beispiel-Hosting" with the eight apps of the Speicherstadt. `bun run dev:demo`,
 * the e2e tests and the screenshots show these fixtures; one operator, as in stage 1.
 */
export const demo: Bestand = {
  jetzt: JETZT,
  betreiber: {
    name: "Beispiel-Hosting",
    domain: "beispiel-hosting.de",
    werte: { ELSTER_HERSTELLER_ID: "12345", BELEGT_TRUSTED_PROXIES: "127.0.0.1" },
    geheimGesetzt: ["ANTHROPIC_API_KEY"],
    s3: "s3.example.net/sz-beispiel-hosting",
  },
  konto: konten[0] ?? { name: "", rolle: "inhaber", faktor: "passkey", zuletzt: JETZT },
  apps,
  server,
  kunden,
  installationen,
  ereignisse,
  auftraege,
  zugaenge,
  audit,
  konten,
  plaene: [
    { app: "belegt", version: "0.10.0", vorher: "0.9.0", seit: berlin("2026-11-18", "08:00") },
  ],
  agentVersion: "0.5.0",
};
