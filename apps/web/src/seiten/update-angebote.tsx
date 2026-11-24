import { Button, Icon, m } from "@steuerzentrale/ui";
import { ArrowRight, ChevronRight, CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, Match, refresh, Show, Switch } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import { type Angebot, appsQuelle, type InstallationsAngebot } from "../daten/apps.ts";
import { bestand } from "../daten/quelle.ts";
import { type AppGruppe, aufDemNeuesten, nachApp } from "../daten/update-gruppen.ts";
import { planText, updateMisslungen, updateText } from "../daten/update-texte.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { Marke } from "../teile/zeichen.tsx";
import { Fehler } from "./anmeldung-teile.tsx";
import { installationsRecht } from "./recht.tsx";
import { UpdateDialog } from "./update-dialog.tsx";

/*
 * The page "Updates" from the Zentrale (BAULISTE.md Z-501, Z-503): the installations offered a
 * newer version, grouped by app (a pre-release only to an internal customer), each with where the
 * plan stands for it, its last update with how it ended and an update by hand for owner and technik
 * (update-dialog.tsx); the current ones folded away below; and what is new in the registries
 * without a manifest.
 */

const AngebotsMarke = (props: { v: Angebot }) => (
  <span
    class={[
      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-sm font-medium whitespace-nowrap",
      props.v.vorabversion ? "border-warn/60 bg-warn/10" : "border-foreground/25",
    ]}
  >
    {props.v.version}
    <Show when={props.v.dringend}>
      <Icon icon={TriangleAlert} size={12} class="text-destructive" label={m.version_dringend()} />
    </Show>
    <Show when={props.v.vorabversion}>
      <span class="font-sans text-xs font-semibold text-warn">{m.version_vorab()}</span>
    </Show>
  </span>
);

const text = (i: InstallationsAngebot) => updateText(i.update, bestand().jetzt);

/** The last update: a good one with a sign, one rolled back or failed in the warning's colour */
const LetztesUpdate = (props: { i: InstallationsAngebot }) => (
  <p class="text-sm text-muted-foreground">
    <Switch fallback={m.upd_zeile_zuletzt({ text: text(props.i) })}>
      <Match when={props.i.update.letzter?.phase === "aktualisiert"}>
        <span class="inline-flex items-center gap-1">
          <Icon icon={CircleCheck} size={14} class="text-ok" />
          {m.upd_zeile_zuletzt({ text: text(props.i) })}
        </span>
      </Match>
      <Match when={updateMisslungen(props.i.update)}>
        <span class="inline-flex items-start gap-1 font-medium text-warn">
          <Icon icon={TriangleAlert} size={14} class="mt-0.5 shrink-0" />
          {m.upd_zeile_zuletzt({ text: text(props.i) })}
        </span>
      </Match>
    </Switch>
  </p>
);

/** Whether an update by hand can be asked for now: a newer version, none under way */
const aktualisierbar = (i: InstallationsAngebot) => i.angeboten.length > 0 && !i.update.laeuft;

/** The customer's name where the operator's customers are known, and the installation's ID */
const Name = (props: { i: InstallationsAngebot }) => (
  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
    <Show when={suche(bestand().kunden, props.i.kundeId)}>
      {(k) => <span class="font-semibold">{k().name}</span>}
    </Show>
    <ZuInstallation
      id={props.i.installationId}
      class={
        suche(bestand().kunden, props.i.kundeId)
          ? "font-mono text-xs text-muted-foreground"
          : "font-mono font-medium"
      }
    >
      {props.i.installationId}
    </ZuInstallation>
    <Show when={props.i.intern}>
      <Marke class="text-muted-foreground">{m.upd_kunde_intern()}</Marke>
    </Show>
  </div>
);

const Kandidat = (props: {
  i: InstallationsAngebot;
  darf: boolean;
  waehlen: (i: InstallationsAngebot) => void;
}) => (
  <li
    data-installation={props.i.installationId}
    class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="grid min-w-0 gap-1.5">
      <Name i={props.i} />
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm text-muted-foreground">{props.i.version}</span>
        <Icon icon={ArrowRight} size={14} class="text-muted-foreground" />
        <For each={props.i.angeboten}>{(v) => <AngebotsMarke v={v} />}</For>
      </div>
      <Show when={props.i.plan}>
        <p class="text-sm text-muted-foreground">
          {m.upd_zeile_plan({ text: planText(props.i.plan, bestand().jetzt) })}
        </p>
      </Show>
      <LetztesUpdate i={props.i} />
    </div>
    <Show when={props.darf && aktualisierbar(props.i)}>
      <Button
        class="self-start sm:self-center"
        aria-label={m.upd_knopf_installation({ name: props.i.installationId })}
        onClick={() => props.waehlen(props.i)}
      >
        {m.upd_knopf()}
      </Button>
    </Show>
  </li>
);

const appName = (app: string) => suche(bestand().apps, app)?.name ?? app;

const Gruppe = (props: {
  g: AppGruppe;
  darf: boolean;
  waehlen: (i: InstallationsAngebot) => void;
}) => (
  <section class="grid gap-2" aria-label={`${appName(props.g.app)} ${props.g.neueste}`}>
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 class="text-lg font-semibold">
        {appName(props.g.app)} <span class="font-mono">{props.g.neueste}</span>
      </h3>
      <span class="text-muted-foreground">
        {props.g.installationen.length === 1
          ? m.upd_gruppe_eine()
          : m.upd_gruppe_mehrere({ n: props.g.installationen.length })}
      </span>
    </div>
    <ul class="divide-y rounded-lg border">
      <For each={props.g.installationen}>
        {(i) => <Kandidat i={i} darf={props.darf} waehlen={props.waehlen} />}
      </For>
    </ul>
  </section>
);

/** The current installations, folded away: they need nothing */
const AufDemNeuesten = (props: { liste: InstallationsAngebot[] }) => (
  <Karte>
    <details class="group">
      <summary class="flex cursor-pointer list-none items-center gap-2 p-5 font-semibold [&::-webkit-details-marker]:hidden">
        <Icon
          icon={ChevronRight}
          size={16}
          class="text-muted-foreground transition-transform group-open:rotate-90"
        />
        <h2>{m.upd_neuester_titel({ n: props.liste.length })}</h2>
      </summary>
      <KartenInhalt>
        <ul class="divide-y rounded-lg border">
          <For
            each={props.liste}
            fallback={<li class="px-4 py-3 text-muted-foreground">{m.upd_neuester_keine()}</li>}
          >
            {(i) => (
              <li
                data-installation={i.installationId}
                class="grid gap-1.5 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4"
              >
                <div class="grid min-w-0 gap-1">
                  <Name i={i} />
                  <LetztesUpdate i={i} />
                </div>
                <span class="flex shrink-0 items-center gap-1.5 text-sm">
                  <span class="text-muted-foreground">{appName(i.app)}</span>
                  <span class="font-mono">{i.version}</span>
                  <Icon icon={CircleCheck} size={14} class="text-ok" label={m.upd_aktuell()} />
                </span>
              </li>
            )}
          </For>
        </ul>
      </KartenInhalt>
    </details>
  </Karte>
);

/**
 * "Updates verfügbar" by app with an update by hand for owner and technik, and the current ones
 * folded away; read anew once an update is asked for
 */
export const Angebote = () => {
  const antwort = createMemo(() => appsQuelle().angebote());
  const darf = installationsRecht();
  const [gewaehlt, setGewaehlt] = createSignal<InstallationsAngebot | undefined>();
  const [hinweis, setHinweis] = createSignal("");
  const liste = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  const gruppen = () => nachApp(liste());
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
      <Karte>
        <KartenKopf titel={m.upd_verfuegbar_titel()} text={m.upd_verfuegbar_text()} />
        <KartenInhalt class="grid gap-6">
          <Show when={!antwort().ok}>
            <Fehler text={m.apps_versionen_fehler()} />
          </Show>
          <Switch>
            <Match when={antwort().ok && liste().length === 0}>
              <p class="text-muted-foreground">{m.upd_keine_installationen()}</p>
            </Match>
            <Match when={antwort().ok && gruppen().length === 0}>
              <p class="flex items-center gap-2 text-muted-foreground">
                <Icon icon={CircleCheck} size={16} class="text-ok" />
                {m.upd_verfuegbar_keine()}
              </p>
            </Match>
          </Switch>
          <For each={gruppen()}>
            {(g) => <Gruppe g={g} darf={darf()} waehlen={(x) => setGewaehlt(x)} />}
          </For>
          <p role="status" class={["text-sm text-muted-foreground", { hidden: !hinweis() }]}>
            {hinweis()}
          </p>
        </KartenInhalt>
      </Karte>
      <Show when={liste().length > 0}>
        <AufDemNeuesten liste={aufDemNeuesten(liste())} />
      </Show>
      <UpdateDialog
        i={gewaehlt()}
        onClose={() => setGewaehlt(undefined)}
        angefordert={() => {
          setGewaehlt(undefined);
          setHinweis(m.upd_angefordert());
          refresh(antwort);
        }}
      />
    </Loading>
  );
};

/** Versions only the registries have: no update until their manifest is imported */
export const NeuInRegistry = () => {
  const antwort = createMemo(() => appsQuelle().liste());
  const neu = () => {
    const a = antwort();
    return a.ok
      ? a.daten.flatMap((app) =>
          app.versionen
            .filter((v) => v.zustand === "manifest_fehlt")
            .map((v) => ({ app: app.app, version: v.version })),
        )
      : [];
  };
  return (
    <Karte>
      <KartenKopf titel={m.upd_registry()} text={m.upd_registry_text()} />
      <KartenInhalt>
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <ul class="grid gap-2">
            <For
              each={neu()}
              fallback={<li class="text-muted-foreground">{m.uebersicht_keine_versionen()}</li>}
            >
              {(x) => (
                <li class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{x.app}</span>
                  <span class="font-mono text-xs">{x.version}</span>
                  <span class="text-xs text-muted-foreground">
                    {m.apps_version_manifest_fehlt()}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};

/** Signed in: the offers with plan and last update, and the registries' news */
export const UpdatesDerZentrale = () => (
  <div class="grid gap-6">
    <Angebote />
    <NeuInRegistry />
  </div>
);
