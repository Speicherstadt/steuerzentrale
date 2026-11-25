import { m } from "@steuerzentrale/ui";
import { createRootRoute, Outlet, redirect, useLocation } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ohneRahmen, zielVor } from "../anmeldung/sitzung.ts";
import { Kopf } from "../rahmen/kopf.tsx";
import { Seitenleiste } from "../rahmen/seitenleiste.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";

/**
 * The shell (DESIGN.md; design/mockup/, after shadcn's "dashboard-01"): the sidebar beside the page
 * from md on, the header with the path above the content. Only for operators; customers never sign
 * in. Sign-in, setup and invitation stand outside it; a page of the shell first asks whether
 * the account may see it (src/anmeldung/sitzung.ts), the server checks every route anyway.
 */
const Rahmen = () => (
  <div class="flex min-h-svh w-full bg-sidebar">
    <aside
      aria-label={m.nav_seitenleiste()}
      class="sticky top-0 hidden h-svh w-64 shrink-0 flex-col md:flex"
    >
      <Seitenleiste />
    </aside>
    <div class="relative flex min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:rounded-xl md:border">
      <Kopf />
      <main class="grid flex-1 grid-cols-[minmax(0,1fr)] content-start px-4 py-4 md:py-6 lg:px-6">
        <Outlet />
      </main>
    </div>
  </div>
);

const Wurzel = () => {
  const ort = useLocation();
  return (
    <Show when={!ohneRahmen(ort().pathname)} fallback={<Outlet />}>
      <Rahmen />
    </Show>
  );
};

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const ziel = await zielVor(location.pathname);
    if (ziel) throw redirect({ to: ziel });
  },
  component: Wurzel,
  notFoundComponent: NichtGefunden,
});
