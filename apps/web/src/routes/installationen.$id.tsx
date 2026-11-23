import { Icon, m, type Tab, Tabs } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, Loading, Match, refresh, Show, Switch } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { anzeige, linuxNutzerVon, titelVon } from "../daten/installation-ansicht.ts";
import { type Einzelansicht, einzelansichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { Aktionen } from "../seiten/installation-aktionen.tsx";
import {
  EinrichtungsAngaben,
  EinrichtungsAuftraege,
  Gescheitert,
  InstallationsWerte,
} from "../seiten/installation-einrichtung.tsx";
import { UnitsUndHealth, Verlauf } from "../seiten/installation-health.tsx";
import { EinstellungenAendern } from "../seiten/installation-konfigurieren.tsx";
import { InstallationBackups, InstallationEinstellungen } from "../seiten/installation-reiter.tsx";
import { InstallationZustand } from "../seiten/installation-zustand.tsx";
import { ZielEreignisse } from "../seiten/ziel-ereignisse.tsx";
import { appIcon } from "../teile/app-icon.ts";
import { Karte, KartenInhalt } from "../teile/karte.tsx";
import { KommtNoch } from "../teile/kommt-noch.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";
import { InstallationsZeichen, Version } from "../teile/zeichen.tsx";

/**
 * One installation (BAULISTE.md Z-402): from the Zentrale its place, ports, values and setup jobs,
 * its state with reason and history (Z-403), after a failed setup the way to remove it, and once
 * it runs "Einstellungen ändern" (Z-404) and the actions its manifest offers (Z-405).
 * Its events come from the Zentrale (Z-406); snapshots come with Z-601, so signed in the tab says
 * so. Settings from the manifest, snapshots and the check from outside of the demo data show only
 * in `dev:demo`, for an installation the demo knows by id.
 */

const Kopf = (props: { a: Einzelansicht }) => (
  <div class="flex min-w-0 items-center gap-4">
    <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent">
      <Icon icon={appIcon(props.a.appIcon)} size={24} />
    </span>
    <div class="grid min-w-0 gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{titelVon(props.a)}</h1>
        <InstallationsZeichen
          anzeige={anzeige(props.a)}
          gekuendigt={props.a.vertragsende !== null}
        />
        <Version version={props.a.version} />
      </div>
      <p class="font-mono text-xs break-all text-muted-foreground">
        {props.a.host} · {linuxNutzerVon(props.a)}@{props.a.serverName}
      </p>
    </div>
  </div>
);

/** The tabs: the demo's for an installation it knows, else what the Zentrale has */
const reiter = (b: Bestand, a: Einzelansicht, demo: Installation | undefined): Tab[] => {
  const einrichtung = () => (
    <div class="grid gap-4 lg:grid-cols-2">
      <EinrichtungsAngaben a={a} />
      <EinrichtungsAuftraege auftraege={a.auftraege} />
    </div>
  );
  const verlauf = () => <Verlauf verlauf={a.verlauf} />;
  const ereignisse: Tab = {
    id: "ereignisse",
    label: m.nav_ereignisse(),
    content: () => (
      <Karte>
        <KartenInhalt class="grid gap-4 pt-5">
          <ZielEreignisse ziele={[`installation:${a.id}`]} />
        </KartenInhalt>
      </Karte>
    ),
  };
  if (!demo)
    return [
      {
        id: "zustand",
        label: m.server_spalte_zustand(),
        content: () => (
          <div class="grid gap-4">
            <div class="grid gap-4 lg:grid-cols-2">
              <UnitsUndHealth health={a.health} />
              {verlauf()}
            </div>
            {einrichtung()}
          </div>
        ),
      },
      {
        id: "einstellungen",
        label: m.nav_einstellungen(),
        content: () => <InstallationsWerte a={a} />,
      },
      {
        id: "backups",
        label: m.nav_backups(),
        content: () => <KommtNoch punkt="Z-601" text={m.backups_spaeter()} />,
      },
      ereignisse,
    ];
  return [
    {
      id: "zustand",
      label: m.server_spalte_zustand(),
      content: () => (
        <div class="grid gap-4">
          <InstallationZustand b={b} i={demo} health={a.health} />
          {verlauf()}
          {einrichtung()}
        </div>
      ),
    },
    {
      id: "einstellungen",
      label: m.nav_einstellungen(),
      content: () => <InstallationEinstellungen b={b} i={demo} />,
    },
    {
      id: "backups",
      label: m.nav_backups(),
      content: () => <InstallationBackups b={b} i={demo} />,
    },
    ereignisse,
  ];
};

const Detail = (props: { a: Einzelansicht; neu: () => void }) => {
  const b = bestand();
  return (
    <div class="grid gap-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <Kopf a={props.a} />
        <Show when={props.a.zustand === "laeuft"}>
          <div class="flex flex-wrap gap-2">
            <Aktionen a={props.a} neu={() => props.neu()} />
            <EinstellungenAendern a={props.a} konfiguriert={() => props.neu()} />
          </div>
        </Show>
      </div>
      <Show when={props.a.zustand === "gescheitert"}>
        <Gescheitert a={props.a} entfernt={() => props.neu()} />
      </Show>
      <Tabs label={m.inst_reiter()} tabs={reiter(b, props.a, props.a.demo)} />
    </div>
  );
};

const InstallationSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(
    (): Promise<Antwort<Einzelansicht>> => einzelansichtLaden(params().id),
  );
  const installation = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  const fehlt = () => {
    const a = antwort();
    return !a.ok && a.status === 404;
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden_eine()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={installation()}>
          {(a) => <Detail a={a()} neu={() => refresh(antwort)} />}
        </Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/installationen/$id")({ component: InstallationSeite });
