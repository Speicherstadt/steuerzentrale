import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import { Box, HeartPulse } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import {
  grundText,
  type HealthDerZentrale,
  unitOk,
  type Verlaufseintrag,
} from "../daten/bewertung.ts";
import { vor, zeitpunkt } from "../format/zeit.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Pruefzeile } from "../teile/listen.tsx";
import { HealthZeichen } from "../teile/zeichen.tsx";

/*
 * The state of an installation from the agent's reports (BAULISTE.md Z-403): green, yellow, red or
 * unknown with its reason and since when, the units of the last report, and the history of every
 * change. "Now" is the browser's clock: the API reports instants, the page says how long ago.
 */

/** The reason, and since when once the agent reported */
const healthDetail = (h: HealthDerZentrale) =>
  h.seit === null
    ? grundText(h.grund)
    : m.inst_bewertung_seit({ grund: grundText(h.grund), zeit: zeitpunkt(h.seit, Date.now()) });

const HealthZeile = (props: { health: HealthDerZentrale }) => (
  <div class="flex items-center gap-3 rounded-lg border p-3" data-testid="health">
    <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent">
      <Icon icon={HeartPulse} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium leading-none">{m.inst_health()}</p>
      <p class="mt-1 text-xs break-words text-muted-foreground">{healthDetail(props.health)}</p>
    </div>
    <HealthZeichen health={props.health.zustand} gekuendigt={false} />
  </div>
);

/** The state with its reason and the units, `children` for rows the demo adds (its backup) */
export const UnitsUndHealth = (props: {
  health: HealthDerZentrale;
  class?: string | undefined;
  children?: JSX.Element;
}) => (
  <Karte class={props.class}>
    <KartenKopf
      titel={m.inst_units()}
      text={
        props.health.gemeldetAm === null
          ? m.inst_bewertung_keine()
          : m.inst_bewertung_text({ vor: vor(props.health.gemeldetAm, Date.now()) })
      }
    />
    <KartenInhalt class="grid gap-3">
      <HealthZeile health={props.health} />
      <For each={props.health.units}>
        {(u) => (
          <Pruefzeile
            icon={Box}
            name={u.name}
            detail={m.inst_unit_aktiv({ aktiv: u.aktiv })}
            ok={unitOk(u.aktiv)}
          />
        )}
      </For>
      {props.children}
    </KartenInhalt>
  </Karte>
);

/** Every change of the state, newest first */
export const Verlauf = (props: { verlauf: Verlaufseintrag[] }) => (
  <Karte>
    <KartenKopf titel={m.inst_verlauf()} text={m.inst_verlauf_text()} />
    <KartenInhalt>
      <Show
        when={props.verlauf.length > 0}
        fallback={<p class="text-muted-foreground">{m.inst_verlauf_leer()}</p>}
      >
        <ol class="grid grid-cols-[minmax(0,1fr)] gap-3" data-testid="verlauf">
          <For each={props.verlauf}>
            {(v) => (
              <li class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span class="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {zeitpunkt(v.zeitpunkt, Date.now())}
                </span>
                <HealthZeichen health={v.bewertung} gekuendigt={false} />
                <span class="min-w-0 flex-1 text-xs break-words text-muted-foreground">
                  {grundText(v.grund)}
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </KartenInhalt>
  </Karte>
);
