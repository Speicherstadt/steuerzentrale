import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, Clock, type IconNode, LoaderCircle, Minus } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import { kundeVon } from "../daten/ableitungen.ts";
import type { Bestand, Installation, Updateplan } from "../daten/typen.ts";
import { planStand, type WellenStand, type WellenZustand, wellen } from "../daten/wellen.ts";
import { datum } from "../format/zeit.ts";
import { Balken } from "../teile/balken.tsx";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";

/*
 * "Läuft gerade" on the page "Updates" (docs/updates.md, "Wellen"): one sentence with how many
 * installations reached the version, and the two waves as numbered steps with plain names, each
 * with its installations and their state. Waves come from the demo until Z-503 brings them.
 */

type Stand = WellenZustand;

const STAND: Record<Stand, { icon: IconNode; farbe: string; text: () => string }> = {
  fertig: { icon: CircleCheck, farbe: "text-ok", text: () => m.welle_fertig() },
  laeuft: { icon: LoaderCircle, farbe: "text-info", text: () => m.auftrag_laeuft() },
  wartet: { icon: Clock, farbe: "text-muted-foreground", text: () => m.auftrag_wartet() },
  leer: { icon: Minus, farbe: "text-muted-foreground", text: () => m.welle_leer() },
};

const SCHRITT = {
  intern: { titel: () => m.upd_schritt_intern_titel(), text: () => m.upd_schritt_intern_text() },
  alle: { titel: () => m.upd_schritt_alle_titel(), text: () => m.upd_schritt_alle_text() },
};

const standVon = (i: Installation, plan: Updateplan): Stand => {
  if (i.version === plan.version) return "fertig";
  return i.updateLaeuft ? "laeuft" : "wartet";
};

const StandZeichen = (props: { stand: Stand }) => (
  <span class={["inline-flex items-center gap-1.5 font-medium", STAND[props.stand].farbe]}>
    <Icon icon={STAND[props.stand].icon} size={16} />
    <span>{STAND[props.stand].text()}</span>
  </span>
);

const Schritt = (props: { b: Bestand; plan: Updateplan; w: WellenStand; n: number }) => (
  <li class="relative grid grid-cols-[2rem_1fr] gap-x-4">
    <span
      class={[
        "flex size-8 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
        { "border-ok text-ok": props.w.zustand === "fertig" },
      ]}
    >
      {props.n}
    </span>
    <div class="grid min-w-0 gap-3 pb-1">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 class="text-base font-semibold">{SCHRITT[props.w.welle].titel()}</h3>
        <StandZeichen stand={props.w.zustand} />
      </div>
      <p class="-mt-2 text-muted-foreground">{SCHRITT[props.w.welle].text()}</p>
      <Show when={props.w.installationen.length > 0}>
        <ul class="grid gap-1 rounded-lg border">
          <For each={props.w.installationen}>
            {(i) => (
              <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3 py-2 last:border-b-0">
                <ZuInstallation id={i.id} class="font-medium hover:underline">
                  {kundeVon(props.b, i.kunde).name}
                </ZuInstallation>
                <StandZeichen stand={standVon(i, props.plan)} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  </li>
);

const Plan = (props: { b: Bestand; plan: Updateplan }) => {
  const stand = () => planStand(props.b, props.plan);
  return (
    <div class="grid gap-6">
      <div class="grid gap-3">
        <p class="text-lg font-semibold leading-snug">
          {m.upd_laeuft_satz({
            app: stand().app.name,
            version: props.plan.version,
            fertig: stand().fertig,
            gesamt: stand().gesamt,
          })}
        </p>
        <div class="flex items-center gap-3">
          <Balken
            name={m.upd_laeuft_fortschritt({
              app: stand().app.name,
              version: props.plan.version,
            })}
            wert={stand().gesamt ? Math.round((stand().fertig / stand().gesamt) * 100) : 0}
            class="h-2.5"
          />
          <span class="shrink-0 font-semibold tabular-nums">
            {stand().fertig}/{stand().gesamt}
          </span>
        </div>
        <p class="text-muted-foreground">
          {m.upd_laeuft_seit({ seit: datum(props.plan.seit), vorher: props.plan.vorher })}
        </p>
      </div>
      <ol class="grid gap-6">
        <For each={wellen(props.b, props.plan)}>
          {(w, n) => <Schritt b={props.b} plan={props.plan} w={w} n={n() + 1} />}
        </For>
      </ol>
    </div>
  );
};

/** The running wave plans, or one calm sentence when none runs */
export const LaeuftGerade = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.upd_laeuft_titel()} />
    <KartenInhalt class="grid gap-8">
      <For
        each={props.b.plaene}
        fallback={<p class="text-muted-foreground">{m.upd_laeuft_keins()}</p>}
      >
        {(plan) => <Plan b={props.b} plan={plan} />}
      </For>
    </KartenInhalt>
  </Karte>
);
