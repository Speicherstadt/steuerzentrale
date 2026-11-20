import "@steuerzentrale/ui/styles.css";
import { render } from "@solidjs/web";
import { getLocale } from "@steuerzentrale/ui";
import { createRouter, RouterProvider } from "@tanstack/solid-router";
import { sitzungsZustand, waechterEinsetzen } from "./anmeldung/sitzung.ts";
import { aktuellesThema, wendeThemaAn } from "./rahmen/theme.ts";
import { routeTree } from "./routeTree.gen.ts";

// The shell needs a signed-in account with its second factor; only `bun run dev:demo`, the fixtures
// without any Zentrale, sets VITE_OHNE_ANMELDUNG and skips the check (the server checks anyway)
if (import.meta.env.VITE_OHNE_ANMELDUNG !== "1") waechterEinsetzen(sitzungsZustand);

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
