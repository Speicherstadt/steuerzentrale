import "@steuerzentrale/ui/styles.css";
import { render } from "@solidjs/web";
import { getLocale } from "@steuerzentrale/ui";
import { createRouter, RouterProvider } from "@tanstack/solid-router";
import { aktuellesThema, wendeThemaAn } from "./rahmen/theme.ts";
import { routeTree } from "./routeTree.gen.ts";

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
