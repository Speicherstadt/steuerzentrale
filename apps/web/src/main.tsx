import "@steuerzentrale/ui/styles.css";
import { render } from "@solidjs/web";
import { getLocale } from "@steuerzentrale/ui";
import { createRouter, RouterProvider } from "@tanstack/solid-router";
import { sitzungsZustand, waechterEinsetzen } from "./anmeldung/sitzung.ts";
import { apiApps, appsQuelleEinsetzen } from "./daten/apps.ts";
import { apiAussen, aussenQuelleEinsetzen } from "./daten/aussen.ts";
import { apiBackups, backupQuelleEinsetzen } from "./daten/backups.ts";
import { apiBetrieb, betriebQuelleEinsetzen } from "./daten/betrieb.ts";
import { apiDns, dnsQuelleEinsetzen } from "./daten/dns.ts";
import { apiEinstellungen, einstellungenQuelleEinsetzen } from "./daten/einstellungen.ts";
import { apiIch, ichQuelleEinsetzen } from "./daten/ich.ts";
import { apiInstallationen, installationenQuelleEinsetzen } from "./daten/installationen.ts";
import { apiKunden, kundenQuelleEinsetzen } from "./daten/kunden.ts";
import { apiLeistungen, leistungenQuelleEinsetzen } from "./daten/leistungen.ts";
import { apiMitglieder, mitgliederQuelleEinsetzen } from "./daten/mitglieder.ts";
import { bestandEinsetzen, ohneDemo } from "./daten/quelle.ts";
import { apiRolle, rollenQuelleEinsetzen } from "./daten/rolle.ts";
import { apiServer, serverQuelleEinsetzen } from "./daten/server.ts";
import { apiSupport, supportQuelleEinsetzen } from "./daten/support.ts";
import { aktuellesThema, wendeThemaAn } from "./rahmen/theme.ts";
import { routeTree } from "./routeTree.gen.ts";

// The shell needs a signed-in account with its second factor, and everything the pages show comes
// from the Zentrale (Z-801, Z-304, Z-402, Z-406, Z-601, Z-802, Z-804), no datum of the demo beside it; only
// `bun run dev:demo`, the fixtures without any Zentrale, sets VITE_OHNE_ANMELDUNG, skips the check
// (the server checks anyway) and keeps the demo sources
if (import.meta.env.VITE_OHNE_ANMELDUNG !== "1") {
  waechterEinsetzen(sitzungsZustand);
  kundenQuelleEinsetzen(apiKunden);
  serverQuelleEinsetzen(apiServer);
  installationenQuelleEinsetzen(apiInstallationen);
  einstellungenQuelleEinsetzen(apiEinstellungen);
  dnsQuelleEinsetzen(apiDns);
  backupQuelleEinsetzen(apiBackups);
  aussenQuelleEinsetzen(apiAussen);
  appsQuelleEinsetzen(apiApps);
  rollenQuelleEinsetzen(apiRolle);
  betriebQuelleEinsetzen(apiBetrieb);
  ichQuelleEinsetzen(apiIch);
  mitgliederQuelleEinsetzen(apiMitglieder);
  supportQuelleEinsetzen(apiSupport);
  leistungenQuelleEinsetzen(apiLeistungen);
  bestandEinsetzen(ohneDemo);
}

const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}

// Before the first render, so a dark theme never flashes light
wendeThemaAn(document.documentElement, aktuellesThema());

const root = document.getElementById("root");
if (root) {
  document.documentElement.lang = getLocale();
  render(() => <RouterProvider router={router} />, root);
}
