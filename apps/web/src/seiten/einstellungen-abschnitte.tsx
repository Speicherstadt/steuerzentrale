import type { JSX } from "@solidjs/web";
import { m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { bestand } from "../daten/quelle.ts";
import { AppWerte } from "./einstellungen-apps.tsx";
import { BackupZielReiter } from "./einstellungen-backup.tsx";
import { BetriebsartReiter } from "./einstellungen-betriebsart.tsx";
import { Dns } from "./einstellungen-dns.tsx";
import { Benachrichtigungen } from "./einstellungen-melden.tsx";
import { Darstellung, Konten, Zentrale } from "./einstellungen-teile.tsx";

/*
 * The sections of the settings (docs/plan.md, "Navigation (Oberfläche 2026-11)"; the approved
 * mockup "Einstellungen"): a list on the left, each with a line on what it holds, the one chosen in
 * the URL (?tab=) and shown on the right. On a phone the list is one row of names that scrolls.
 */

export const ABSCHNITTE = [
  "betriebsart",
  "werte",
  "backup",
  "dns",
  "melden",
  "konten",
  "zentrale",
  "darstellung",
] as const;
export type Abschnitt = (typeof ABSCHNITTE)[number];

type Eintrag = { titel: () => string; text: () => string; inhalt: () => JSX.Element };

const EINTRAEGE: Record<Abschnitt, Eintrag> = {
  betriebsart: {
    titel: m.betriebsart_titel,
    text: m.einst_nav_betriebsart_text,
    inhalt: () => <BetriebsartReiter />,
  },
  werte: { titel: m.einst_nav_werte, text: m.einst_nav_werte_text, inhalt: () => <AppWerte /> },
  backup: {
    titel: m.einst_nav_backup,
    text: m.einst_nav_backup_text,
    inhalt: () => <BackupZielReiter />,
  },
  dns: { titel: m.einst_nav_dns, text: m.einst_nav_dns_text, inhalt: () => <Dns /> },
  melden: {
    titel: m.einst_melden,
    text: m.einst_nav_melden_text,
    inhalt: () => <Benachrichtigungen />,
  },
  konten: { titel: m.einst_konten, text: m.einst_nav_konten_text, inhalt: () => <Konten /> },
  zentrale: {
    titel: m.app_name,
    text: m.einst_nav_zentrale_text,
    inhalt: () => <Zentrale b={bestand()} />,
  },
  darstellung: {
    titel: m.einst_darstellung,
    text: m.einst_nav_darstellung_text,
    inhalt: () => <Darstellung />,
  },
};

const Verweis = (props: { id: Abschnitt }) => (
  <li class="shrink-0">
    <Link
      to="/einstellungen"
      // "Werte für Apps" is the page without a section in the URL (routes/einstellungen.tsx)
      search={props.id === "werte" ? {} : { tab: props.id }}
      replace
      // the router marks the link of the section shown as the current page (aria-current)
      activeOptions={{ exact: true }}
      class="group block cursor-pointer rounded-lg px-3 py-1.5 whitespace-nowrap text-muted-foreground hover:bg-accent/60 hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground lg:px-3.5 lg:py-2.5 lg:whitespace-normal lg:text-foreground"
    >
      <span class="block font-medium">{EINTRAEGE[props.id].titel()}</span>
      <span class="hidden text-muted-foreground group-aria-[current=page]:text-foreground lg:block">
        {EINTRAEGE[props.id].text()}
      </span>
    </Link>
  </li>
);

/** The list of sections, the one shown marked as the current page */
export const AbschnittListe = () => (
  <nav aria-label={m.einst_abschnitte()} class="min-w-0">
    <ul class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:overflow-visible lg:px-0">
      <For each={ABSCHNITTE}>{(id) => <Verweis id={id} />}</For>
    </ul>
  </nav>
);

/** What the chosen section holds */
export const AbschnittInhalt = (props: { gewaehlt: Abschnitt }) => (
  <div class="grid min-w-0 gap-4">
    <For each={ABSCHNITTE}>
      {(id) => <Show when={props.gewaehlt === id}>{EINTRAEGE[id].inhalt()}</Show>}
    </For>
  </div>
);
