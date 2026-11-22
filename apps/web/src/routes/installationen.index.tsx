import { Icon, m, SearchInput } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { appVon, istAktuell, loeschungAm } from "../daten/ableitungen.ts";
import { grundText, grundZeigen } from "../daten/bewertung.ts";
import { anzeige, type InstallationAnsicht } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { ansichtZustand, type ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand } from "../daten/typen.ts";
import { gb } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import {
  FILTER,
  type Filter,
  gefiltert,
  gelistet,
  nachServer,
  passt,
} from "../seiten/installationen-filter.ts";
import { Installieren } from "../seiten/installieren.tsx";
import { agentText } from "../seiten/server-texte.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Schalter } from "../teile/schalter.tsx";
import { Reihe, Tabelle, Zwischenzeile } from "../teile/tabelle.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import {
  ArtZeichen,
  artIcon,
  InstallationsZeichen,
  Marke,
  ServerZeichen,
  Version,
} from "../teile/zeichen.tsx";

/**
 * Every installation of the Zentrale (BAULISTE.md Z-402), grouped by server or as a list, filtered
 * by state, with a search, and the dialog "Installieren". The state with its reason comes from the
 * Zentrale (Z-403); backups and data still from the demo data by id until Z-406, so an installation
 * of the Zentrale shows "–" there.
 */

const FILTERNAMEN: Record<Filter, () => string> = {
  alle: () => m.filter_alle(),
  rot: () => m.health_rot(),
  gelb: () => m.health_gelb(),
  unbekannt: () => m.filter_ohne_zustand(),
  gekuendigt: () => m.health_gekuendigt(),
};

const Leer = () => <span class="text-xs text-muted-foreground">–</span>;

const ZustandZelle = (props: { a: InstallationAnsicht }) => (
  <td>
    <InstallationsZeichen anzeige={anzeige(props.a)} gekuendigt={props.a.vertragsende !== null} />
    <Show
      when={props.a.vertragsende}
      fallback={
        <Show when={props.a.zustand === "laeuft" && grundZeigen(props.a.health)}>
          <span class="mt-1 block max-w-[220px] text-xs text-muted-foreground">
            {grundText(props.a.health.grund)}
          </span>
        </Show>
      }
    >
      {(ende) => (
        <span class="mt-1 block text-xs text-muted-foreground">
          {m.inst_loeschung_am({ datum: datum(loeschungAm(ende())) })}
        </span>
      )}
    </Show>
  </td>
);

const VersionZelle = (props: { b: Bestand; a: InstallationAnsicht }) => (
  <td class="whitespace-nowrap">
    <Version version={props.a.version} />
    <Show when={props.a.demo && !istAktuell(props.b, props.a.demo) && props.a.demo}>
      {(d) => (
        <span class="ml-1 text-xs text-info">
          {d().updateLaeuft
            ? m.inst_update_laeuft()
            : m.inst_neue_version({ version: appVon(props.b, d().app).version ?? "" })}
        </span>
      )}
    </Show>
  </td>
);

const pruefName = (p: "ok" | "offen" | "gescheitert") =>
  p === "ok" ? m.pruef_ok() : p === "gescheitert" ? m.pruef_gescheitert() : m.pruef_offen();

const BackupZelle = (props: { b: Bestand; a: InstallationAnsicht }) => (
  <td class="text-xs whitespace-nowrap">
    <Show when={props.a.demo} fallback={<Leer />}>
      {(d) => (
        <>
          <span class={d().backup.ok ? "" : "font-medium text-warn"}>
            {d().backup.ok
              ? zeitpunkt(d().backup.zeitpunkt, props.b.jetzt)
              : m.inst_backup_alt({ zeit: zeitpunkt(d().backup.zeitpunkt, props.b.jetzt) })}
          </span>
          <span class="block text-muted-foreground">
            {m.inst_pruef_restore({ stand: pruefName(d().pruefRestore) })}
          </span>
        </>
      )}
    </Show>
  </td>
);

const Zeile = (props: { b: Bestand; a: InstallationAnsicht; mitServer: boolean }) => (
  <Reihe>
    <td>
      <ZuInstallation id={props.a.id}>
        <span class="block font-medium">{props.a.kundeName}</span>
        <span class="block font-mono text-xs text-muted-foreground">{props.a.host}</span>
      </ZuInstallation>
    </td>
    <td>
      <Marke>
        <Icon icon={appIcon(props.a.appIcon)} size={14} />
        {props.a.appName}
      </Marke>
    </td>
    <Show when={props.mitServer}>
      <td>
        <ZuServer id={props.a.serverId} class="flex items-center gap-1.5 whitespace-nowrap">
          <Show when={props.a.serverArt}>
            {(art) => <Icon icon={artIcon(art())} size={14} class="text-muted-foreground" />}
          </Show>
          {props.a.serverName}
        </ZuServer>
      </td>
    </Show>
    <ZustandZelle a={props.a} />
    <VersionZelle b={props.b} a={props.a} />
    <BackupZelle b={props.b} a={props.a} />
    <td class="text-right font-mono text-xs whitespace-nowrap tabular-nums">
      <Show when={props.a.demo} fallback={<Leer />}>
        {(d) => <span>{gb(d().datenGb)}</span>}
      </Show>
    </td>
  </Reihe>
);

const Gruppenkopf = (props: { b: Bestand; s: ServerAnsicht; spalten: number }) => (
  <Zwischenzeile spalten={props.spalten}>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ZuServer id={props.s.id} class="flex items-center gap-2 font-medium">
        <Icon icon={artIcon(props.s.art)} />
        {props.s.name}
      </ZuServer>
      <ArtZeichen art={props.s.art} />
      <ServerZeichen zustand={ansichtZustand(props.b, props.s)} />
      <span class="text-xs text-muted-foreground">
        {[
          props.s.os,
          props.s.ramGb === null ? null : m.einheit_gb({ wert: props.s.ramGb }),
          props.s.arch,
          agentText(props.b, props.s),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  </Zwischenzeile>
);

type Gruppe = "server" | "liste";

const Liste = (props: {
  b: Bestand;
  installationen: InstallationAnsicht[];
  server: ServerAnsicht[];
  filter: Filter;
  gruppe: Gruppe;
  frage: string;
}) => {
  const treffer = createMemo(() => gefiltert(props.installationen, props.filter, props.frage));
  const spalten = () => [
    { name: m.inst_spalte_kunde() },
    { name: m.inst_spalte_app() },
    ...(props.gruppe === "liste" ? [{ name: m.server_spalte_server() }] : []),
    { name: m.server_spalte_zustand() },
    { name: m.server_version() },
    { name: m.inst_spalte_backup() },
    { name: m.inst_spalte_daten(), class: "text-right" },
  ];
  return (
    <Tabelle
      name={m.inst_tabelle()}
      minBreite={props.gruppe === "liste" ? 1040 : 900}
      leer={m.installationen_keine()}
      anzahl={treffer().length}
      spalten={spalten()}
    >
      <Show
        when={props.gruppe === "server"}
        fallback={<For each={treffer()}>{(a) => <Zeile b={props.b} a={a} mitServer />}</For>}
      >
        <For each={nachServer(props.server, treffer())}>
          {(g) => (
            <>
              <Gruppenkopf b={props.b} s={g.server} spalten={spalten().length} />
              <For each={g.installationen}>
                {(a) => <Zeile b={props.b} a={a} mitServer={false} />}
              </For>
            </>
          )}
        </For>
      </Show>
    </Tabelle>
  );
};

const Installationen = () => {
  const b = bestand();
  const [filter, setFilter] = createSignal<Filter>("alle");
  const [gruppe, setGruppe] = createSignal<Gruppe>("server");
  const [frage, setFrage] = createSignal("");
  const antwort = createMemo(() => uebersichtLaden());
  const daten = () => {
    const a = antwort();
    return a.ok ? a.daten : { installationen: [], server: [] };
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Seitenkopf
        titel={m.nav_installationen()}
        text={m.inst_text()}
        aktion={<Installieren onAngelegt={() => refresh(antwort)} />}
      />
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div class="flex max-w-full flex-wrap items-center gap-2">
            <Schalter
              name={m.inst_filter()}
              aktuell={filter()}
              onWahl={setFilter}
              wahl={FILTER.map((f) => ({
                wert: f,
                name: FILTERNAMEN[f](),
                anzahl: gelistet(daten().installationen).filter((a) => passt(a, f)).length,
              }))}
            />
            <Schalter
              name={m.inst_ansicht()}
              aktuell={gruppe()}
              onWahl={setGruppe}
              wahl={[
                { wert: "server", name: m.inst_nach_server() },
                { wert: "liste", name: m.inst_liste() },
              ]}
            />
          </div>
          <div class="w-full sm:w-64">
            <SearchInput
              label={m.inst_suche()}
              placeholder={m.inst_suche_platzhalter()}
              value={frage()}
              onInput={(event) => setFrage(event.currentTarget.value)}
            />
          </div>
        </div>
        <Fehler text={fehler()} />
        <Liste
          b={b}
          installationen={daten().installationen}
          server={daten().server}
          filter={filter()}
          gruppe={gruppe()}
          frage={frage()}
        />
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/installationen/")({ component: Installationen });
