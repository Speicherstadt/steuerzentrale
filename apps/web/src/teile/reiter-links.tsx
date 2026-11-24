import { m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";

/**
 * Pages of one area as links that look like tabs (Kunden | Support-Zugänge | Leistungen): each
 * is its own route, so the link of the open page is marked as the current page, not as a selected
 * tab (docs/plan.md, "Navigation (Oberfläche 2026-11)")
 */

export type ReiterLink = {
  pfad: "/kunden" | "/support" | "/leistungen";
  name: string;
};

export const ReiterLinks = (props: { label: string; links: ReiterLink[] }) => (
  <nav
    aria-label={props.label}
    class="inline-flex w-fit max-w-full gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] rounded-lg border border-border bg-muted p-1"
  >
    <For each={props.links}>
      {(link) => (
        <Link
          to={link.pfad}
          activeOptions={{ exact: true }}
          class="rounded-md px-3 py-1 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
        >
          {link.name}
        </Link>
      )}
    </For>
  </nav>
);

/** Kunden with support accesses and usage, which have no menu entry of their own */
export const KundenReiter = () => (
  <ReiterLinks
    label={m.kunden_reiter()}
    links={[
      { pfad: "/kunden", name: m.nav_kunden() },
      { pfad: "/support", name: m.nav_support() },
      { pfad: "/leistungen", name: m.nav_leistungen() },
    ]}
  />
);
