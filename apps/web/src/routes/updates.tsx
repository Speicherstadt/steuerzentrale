import { Icon, m } from "@steuerzentrale/ui";
import {
  CalendarClock,
  Check,
  CircleArrowUp,
  CircleCheck,
  Clock,
  type IconNode,
  LoaderCircle,
  Minus,
} from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import {
  alleSperrzeiten,
  appVon,
  installationenDer,
  kundeVon,
  sperrzeitAktiv,
} from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Updateplan } from "../daten/typen.ts";
import { nurVonHand, type WellenStand, type WellenZustand, wellen } from "../daten/wellen.ts";
import { datum } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";
import { Balken } from "../teile/balken.tsx";
import { Hinweisbox, Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import { AppZeichen, Zustand } from "../teile/zeichen.tsx";

/** New versions in waves (BAULISTE.md, Z-501 to Z-504): stage 1 has "intern" and "alle" */

const WELLENZUSTAND: Record<WellenZustand, { icon: IconNode; farbe: string; text: () => string }> =
  {
    fertig: { icon: CircleCheck, farbe: "text-ok", text: () => m.welle_fertig() },
    laeuft: { icon: LoaderCircle, farbe: "text-info", text: () => m.auftrag_laeuft() },
    wartet: { icon: Clock, farbe: "text-muted-foreground", text: () => m.auftrag_wartet() },
    leer: { icon: Minus, farbe: "text-muted-foreground", text: () => m.welle_leer() },
  };

const WELLENTEXT = { intern: () => m.welle_intern_text(), alle: () => m.welle_alle_text() };

const WelleZeile = (props: { b: Bestand; plan: Updateplan; w: WellenStand }) => (
  <div class="grid gap-2">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <span class="font-medium">{welleName(props.w.welle)}</span>
        <span class="text-muted-foreground"> · {WELLENTEXT[props.w.welle]()}</span>
      </div>
      <Zustand
        icon={WELLENZUSTAND[props.w.zustand].icon}
        farbe={WELLENZUSTAND[props.w.zustand].farbe}
        text={WELLENZUSTAND[props.w.zustand].text()}
      />
    </div>
    <Show when={props.w.installationen.length > 0}>
      <Balken
        name={m.upd_welle_fortschritt({ welle: welleName(props.w.welle) })}
        wert={Math.round((props.w.fertig / props.w.installationen.length) * 100)}
      />
    </Show>
    <ul class="flex flex-wrap gap-1.5">
      <For each={props.w.installationen}>
        {(i) => (
          <li>
            <ZuInstallation
              id={i.id}
              class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted"
            >
              <Icon
                icon={
                  i.version === props.plan.version ? Check : i.updateLaeuft ? LoaderCircle : Clock
                }
                size={12}
                label={
                  i.version === props.plan.version
                    ? m.welle_fertig()
                    : i.updateLaeuft
                      ? m.auftrag_laeuft()
                      : m.auftrag_wartet()
                }
              />
              {kundeVon(props.b, i.kunde).name}
            </ZuInstallation>
          </li>
        )}
      </For>
    </ul>
  </div>
);

const Plan = (props: { b: Bestand; plan: Updateplan }) => (
  <Karte class="lg:col-span-2">
    <KartenKopf
      titel={`${appVon(props.b, props.plan.app).name} ${props.plan.version}`}
      text={m.upd_plan_text({ seit: datum(props.plan.seit), vorher: props.plan.vorher })}
    />
    <KartenInhalt class="grid gap-5">
      <For each={wellen(props.b, props.plan)}>
        {(w) => <WelleZeile b={props.b} plan={props.plan} w={w} />}
      </For>
      <p class="text-xs text-muted-foreground">{m.upd_regel()}</p>
    </KartenInhalt>
  </Karte>
);

const SCHRITTE = [
  () => m.upd_schritt_backup(),
  () => m.upd_schritt_image(),
  () => m.upd_schritt_nach_update(),
  () => m.upd_schritt_neustart(),
  () => m.upd_schritt_zurueck(),
];

const Ablauf = () => (
  <Karte>
    <KartenKopf titel={m.upd_ablauf()} text={m.upd_ablauf_text()} />
    <KartenInhalt>
      <ol class="grid gap-4">
        <For each={SCHRITTE}>
          {(schritt, n) => (
            <li class="flex items-start gap-3">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums">
                {n() + 1}
              </span>
              <span class="pt-0.5">{schritt()}</span>
            </li>
          )}
        </For>
      </ol>
    </KartenInhalt>
  </Karte>
);

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

const Registry = (props: { b: Bestand }) => {
  const neu = () => props.b.apps.filter((a) => a.ohneManifest);
  return (
    <Karte>
      <KartenKopf titel={m.upd_registry()} text={m.upd_registry_text()} />
      <KartenInhalt>
        <ul class="grid gap-3">
          <For
            each={neu()}
            fallback={<li class="text-muted-foreground">{m.uebersicht_keine_versionen()}</li>}
          >
            {(a) => (
              <li class="flex flex-wrap items-center gap-2">
                <AppZeichen app={a} />
                <span class="font-mono text-xs">
                  {a.version} → {a.ohneManifest}
                </span>
                <span class="text-xs text-muted-foreground">
                  {m.upd_manifest_fehlt({ n: installationenDer(props.b, a.id).length })}
                </span>
              </li>
            )}
          </For>
        </ul>
      </KartenInhalt>
    </Karte>
  );
};

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

const Updates = () => {
  const b = bestand();
  const sperren = alleSperrzeiten(b);
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_updates()} text={m.upd_text()} />
      <Hinweisbox icon={<Icon icon={CalendarClock} />} titel={m.upd_sperrzeiten()}>
        {sperren
          .map((z) => m.upd_sperrzeit({ app: z.appName, von: z.von, bis: z.bis, grund: z.grund }))
          .join("; ")}{" "}
        {sperren.some((z) => sperrzeitAktiv(z, b.jetzt))
          ? m.upd_sperrzeit_aktiv()
          : m.upd_sperrzeit_keine()}
      </Hinweisbox>
      <For each={b.plaene}>
        {(plan) => (
          <div class="grid gap-4 lg:grid-cols-3">
            <Plan b={b} plan={plan} />
            <Ablauf />
          </div>
        )}
      </For>
      <div class="grid gap-4 lg:grid-cols-3">
        <VonHand b={b} />
        <Registry b={b} />
        <Agent b={b} />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/updates")({ component: Updates });
