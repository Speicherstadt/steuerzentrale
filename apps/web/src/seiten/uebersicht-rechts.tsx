import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck } from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import type { Termin } from "../daten/als-naechstes.ts";
import type { Erledigt } from "../daten/von-selbst.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { terminText, wann } from "./vorschau-texte.ts";

/*
 * The right column of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): "Als Nächstes",
 * what the Zentrale does by itself soon, by time; "Von selbst erledigt", what it did since yesterday
 * evening, with the way to the Protokoll.
 */

const linkClass = "underline underline-offset-4 hover:text-foreground";

export const AlsNaechstes = (props: { termine: Termin[]; jetzt: number }) => (
  <Karte>
    <KartenKopf titel={m.naechstes_titel()} text={m.naechstes_text()} />
    <KartenInhalt>
      <Show
        when={props.termine.length > 0}
        fallback={<p class="text-muted-foreground">{m.naechstes_leer()}</p>}
      >
        <ul class="grid divide-y">
          <For each={props.termine}>
            {(t) => (
              <li class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 py-3 first:pt-0 last:pb-0">
                <span
                  class={[
                    "tabular-nums",
                    t.warn ? "font-medium text-warn" : "text-muted-foreground",
                  ]}
                >
                  {wann(t, props.jetzt)}
                </span>
                <span class="min-w-0">
                  <span class="block font-medium">{terminText(t).titel}</span>
                  <span class="block break-words text-muted-foreground">{terminText(t).text}</span>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </KartenInhalt>
  </Karte>
);

type Zeile = { was: string; rest: string };

/** The lines of "Von selbst erledigt": what in bold, then the rest of the sentence */
const erledigtZeilen = (e: Erledigt): Zeile[] => [
  ...(e.backups > 0
    ? [
        {
          was: e.backups === 1 ? m.erledigt_backups_eins() : m.erledigt_backups({ n: e.backups }),
          rest: m.erledigt_gesichert(),
        },
      ]
    : []),
  ...e.updates.map((u) => ({
    was: `${u.appName} ${u.version}`,
    rest:
      u.kunden.length > 1
        ? m.erledigt_eingespielt_apps({ n: u.kunden.length })
        : m.erledigt_eingespielt_bei({ kunde: u.kunden[0] ?? "" }),
  })),
  ...(e.pruefRestores > 0
    ? [
        {
          was:
            e.pruefRestores === 1
              ? m.erledigt_pruef_eins()
              : m.erledigt_pruef({ n: e.pruefRestores }),
          rest: m.erledigt_gelungen(),
        },
      ]
    : []),
  ...(e.neustarts > 0
    ? [
        {
          was: e.neustarts === 1 ? m.erledigt_server_eins() : m.erledigt_server({ n: e.neustarts }),
          rest: m.erledigt_neu_gestartet(),
        },
      ]
    : []),
  ...(e.sicherheitsupdates > 0
    ? [
        {
          was: m.erledigt_sicherheitsupdates(),
          rest:
            e.sicherheitsupdates === 1
              ? m.erledigt_sicherheitsupdates_eins()
              : m.erledigt_sicherheitsupdates_text({ n: e.sicherheitsupdates }),
        },
      ]
    : []),
];

export const VonSelbst = (props: { erledigt: Erledigt }) => (
  <Karte>
    <KartenKopf titel={m.erledigt_titel()} text={m.erledigt_text()} />
    <KartenInhalt>
      <Show
        when={erledigtZeilen(props.erledigt).length > 0}
        fallback={<p class="text-muted-foreground">{m.erledigt_leer()}</p>}
      >
        <ul class="grid divide-y">
          <For each={erledigtZeilen(props.erledigt)}>
            {(z) => (
              <li class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon icon={CircleCheck} class="shrink-0 text-ok" />
                <span class="min-w-0">
                  <span class="font-medium">{z.was}</span>{" "}
                  <span class="text-muted-foreground">{z.rest}</span>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </KartenInhalt>
    <div class="border-t px-5 py-4">
      <Link to="/protokoll" class={linkClass}>
        {m.erledigt_protokoll()}
      </Link>
    </div>
  </Karte>
);
