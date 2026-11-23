import "@steuerzentrale/ui/styles.css";
import { render } from "@solidjs/web";
import { getLocale } from "@steuerzentrale/ui";
import { createRouter, RouterProvider } from "@tanstack/solid-router";
import { sitzungsZustand, waechterEinsetzen } from "./anmeldung/sitzung.ts";
import { apiDns, dnsQuelleEinsetzen } from "./daten/dns.ts";
import { apiEinstellungen, einstellungenQuelleEinsetzen } from "./daten/einstellungen.ts";
import { apiInstallationen, installationenQuelleEinsetzen } from "./daten/installationen.ts";
import { apiKunden, kundenQuelleEinsetzen } from "./daten/kunden.ts";
import { apiRolle, rollenQuelleEinsetzen } from "./daten/rolle.ts";
import { apiServer, serverQuelleEinsetzen } from "./daten/server.ts";
import { aktuellesThema, wendeThemaAn } from "./rahmen/theme.ts";
import { routeTree } from "./routeTree.gen.ts";

// The shell needs a signed-in account with its second factor, and customers, servers and
// installations come from the Zentrale (Z-801, Z-304, Z-402); only `bun run dev:demo`, the fixtures
// without any Zentrale, sets VITE_OHNE_ANMELDUNG, skips the check (the server checks anyway) and
// keeps the demo sources
if (import.meta.env.VITE_OHNE_ANMELDUNG !== "1") {
  waechterEinsetzen(sitzungsZustand);
  kundenQuelleEinsetzen(apiKunden);
  serverQuelleEinsetzen(apiServer);
  installationenQuelleEinsetzen(apiInstallationen);
  einstellungenQuelleEinsetzen(apiEinstellungen);
  dnsQuelleEinsetzen(apiDns);
  rollenQuelleEinsetzen(apiRolle);
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
