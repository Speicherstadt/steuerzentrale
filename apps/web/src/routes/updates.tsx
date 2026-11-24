import { Icon, m } from "@steuerzentrale/ui";
import { CalendarClock, ChevronRight, CircleArrowUp } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { alleSperrzeiten, sperrzeitAktiv } from "../daten/ableitungen.ts";
import { bestand, mitDemo } from "../daten/quelle.ts";
import type { Bestand } from "../daten/typen.ts";
import { sperrzeitBald } from "../daten/update-gruppen.ts";
import { nurVonHand } from "../daten/wellen.ts";
import { Angebote, NeuInRegistry, UpdatesDerZentrale } from "../seiten/update-angebote.tsx";
import { LaeuftGerade } from "../seiten/update-laeuft.tsx";
import { Hinweisbox, Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { ZuServer } from "../teile/verweise.tsx";
import { AppZeichen } from "../teile/zeichen.tsx";

/**
 * New versions in waves (BAULISTE.md, Z-501 to Z-504; docs/updates.md), top to bottom: freeze
 * windows that matter this week, what runs now, what can update by app, what is current (folded),
 * and how an update runs (folded). The offers and the registries' news come from the Zentrale
 * (Z-501); waves and running updates are the demo's until Z-503
 */

const SCHRITTE = [
  () => m.upd_schritt_backup(),
  () => m.upd_schritt_image(),
  () => m.upd_schritt_nach_update(),
  () => m.upd_schritt_neustart(),
  () => m.upd_schritt_zurueck(),
];

/** How an update runs, folded away at the foot of the page */
const Ablauf = () => (
  <Karte>
    <details class="group">
      <summary class="flex cursor-pointer list-none items-center gap-2 p-5 font-semibold [&::-webkit-details-marker]:hidden">
        <Icon
          icon={ChevronRight}
          size={16}
          class="text-muted-foreground transition-transform group-open:rotate-90"
        />
        <h2>{m.upd_ablauf()}</h2>
      </summary>
      <KartenInhalt class="grid gap-4">
        <p class="text-muted-foreground">{m.upd_ablauf_text()}</p>
        <ol class="grid gap-4">
          <For each={SCHRITTE}>
            {(schritt, n) => (
              <li class="flex items-start gap-3">
                <span class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium tabular-nums">
                  {n() + 1}
                </span>
                <span class="pt-0.5 leading-relaxed">{schritt()}</span>
              </li>
            )}
          </For>
        </ol>
      </KartenInhalt>
    </details>
  </Karte>
);

/**
 * Freeze windows: a box only when one holds today or begins within 7 days, else one quiet line;
 * either way it says that no update starts in one
 */
const Sperrzeiten = (props: { b: Bestand }) => {
  const bald = () => alleSperrzeiten(props.b).filter((z) => sperrzeitBald(z, props.b.jetzt));
  const aktiv = () => bald().some((z) => sperrzeitAktiv(z, props.b.jetzt));
  return (
    <Show
      when={bald().length > 0}
      fallback={
        <p class="flex items-center gap-2 text-muted-foreground">
          <Icon icon={CalendarClock} size={16} />
          {m.upd_sperrzeit_ruhig()}
        </p>
      }
    >
      <Hinweisbox
        icon={<Icon icon={CalendarClock} />}
        titel={m.upd_sperrzeiten()}
        ton={aktiv() ? "warn" : "neutral"}
      >
        <ul class="grid gap-1">
          <For each={bald()}>
            {(z) => (
              <li>{m.upd_sperrzeit({ app: z.appName, von: z.von, bis: z.bis, grund: z.grund })}</li>
            )}
          </For>
        </ul>
        <p class="mt-1">
          {aktiv() ? m.upd_sperrzeit_aktiv() : m.upd_sperrzeit_bald()} {m.upd_sperrzeit_regel()}
        </p>
      </Hinweisbox>
    </Show>
  );
};

const VonHand = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.upd_von_hand()} text={m.upd_von_hand_text()} />
    <KartenInhalt>
      <ul class="grid gap-3">
        <For
          each={nurVonHand(props.b)}
          fallback={<li class="text-muted-foreground">{m.upd_von_hand_keine()}</li>}
        >
          {(x) => (
            <li class="flex flex-wrap items-center gap-2">
              <AppZeichen app={x.app} />
              <span class="font-mono text-xs">{x.app.version}</span>
              <span class="text-xs text-muted-foreground">
                {m.upd_zurueck({
                  n: x.zurueck.length,
                  grund: "keine" in x.app.health ? x.app.health.keine : "",
                })}
              </span>
            </li>
          )}
        </For>
      </ul>
    </KartenInhalt>
  </Karte>
);

const Agent = (props: { b: Bestand }) => {
  const alt = () => props.b.server.filter((s) => s.agent.version !== props.b.agentVersion);
  return (
    <Karte>
      <KartenKopf
        titel={m.upd_agent()}
        text={m.upd_agent_text({
          version: props.b.agentVersion,
          n: props.b.server.length - alt().length,
          gesamt: props.b.server.length,
        })}
      />
      <KartenInhalt>
        <ul class="grid gap-3">
          <For each={alt()}>
            {(s) => (
              <li class="flex flex-wrap items-center gap-2">
                <Icon icon={CircleArrowUp} class="text-info" />
                <ZuServer id={s.id}>{s.name}</ZuServer>
                <span class="font-mono text-xs text-muted-foreground">
                  {s.agent.version} → {props.b.agentVersion}
                </span>
                <span class="text-xs text-muted-foreground">
                  {m.upd_agent_fenster({ zeit: s.wartung.von })}
                </span>
              </li>
            )}
          </For>
          <li class="text-xs text-muted-foreground">{m.upd_agent_regel()}</li>
        </ul>
      </KartenInhalt>
    </Karte>
  );
};

const UpdatesDemo = () => {
  const b = bestand();
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_updates()} text={m.upd_text()} />
      <Sperrzeiten b={b} />
      <LaeuftGerade b={b} />
      <Angebote />
      <div class="grid gap-4 lg:grid-cols-3">
        <VonHand b={b} />
        <NeuInRegistry />
        <Agent b={b} />
      </div>
      <Ablauf />
    </div>
  );
};

/**
 * Signed in, nothing of the demo: the offers and the registries' news from the Zentrale; waves and
 * running updates come with Z-503 (docs/plan.md, "Echte Daten (Z-406)")
 */
const Updates = () => (
  <Show
    when={mitDemo()}
    fallback={
      <div class="grid gap-6">
        <Seitenkopf titel={m.nav_updates()} text={m.upd_text()} />
        <UpdatesDerZentrale />
        <Ablauf />
      </div>
    }
  >
    <UpdatesDemo />
  </Show>
);

export const Route = createFileRoute("/updates")({ component: Updates });
