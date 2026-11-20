import { Icon, m, SearchInput } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  appVon,
  istAktuell,
  istGekuendigt,
  kundeVon,
  loeschungAm,
  serverVon,
} from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { serverZustand } from "../daten/zustand.ts";
import { gb } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import {
  FILTER,
  type Filter,
  gefiltert,
  nachServer,
  passt,
} from "../seiten/installationen-filter.ts";
import { agentText } from "../seiten/server-texte.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Schalter } from "../teile/schalter.tsx";
import { Reihe, Tabelle, Zwischenzeile } from "../teile/tabelle.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import {
  AppZeichen,
  ArtZeichen,
  artIcon,
  HealthZeichen,
  ServerZeichen,
  Version,
} from "../teile/zeichen.tsx";

/** Every installation, grouped by server or as a list, filtered by state, with a search */

const FILTERNAMEN: Record<Filter, () => string> = {
  alle: () => m.filter_alle(),
  rot: () => m.health_rot(),
  gelb: () => m.health_gelb(),
  unbekannt: () => m.filter_ohne_zustand(),
  gekuendigt: () => m.health_gekuendigt(),
};

const pruefName = (i: Installation) =>
  i.pruefRestore === "ok"
    ? m.pruef_ok()
    : i.pruefRestore === "gescheitert"
      ? m.pruef_gescheitert()
      : m.pruef_offen();

const ZustandZelle = (props: { b: Bestand; i: Installation }) => {
  const kunde = () => kundeVon(props.b, props.i.kunde);
  return (
    <td>
      <HealthZeichen health={props.i.health} gekuendigt={istGekuendigt(props.b, props.i)} />
      <Show
        when={kunde().vertrag.ende}
        fallback={
          <Show when={props.i.grund}>
            <span class="mt-1 block max-w-[220px] text-xs text-muted-foreground">
              {props.i.grund}
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
};

const Zeile = (props: { b: Bestand; i: Installation; mitServer: boolean }) => {
  const sv = () => serverVon(props.b, props.i.server);
  return (
    <Reihe>
      <td>
        <ZuInstallation id={props.i.id}>
          <span class="block font-medium">{kundeVon(props.b, props.i.kunde).name}</span>
          <span class="block font-mono text-xs text-muted-foreground">{props.i.adresse}</span>
        </ZuInstallation>
      </td>
      <td>
        <AppZeichen app={appVon(props.b, props.i.app)} />
      </td>
      <Show when={props.mitServer}>
        <td>
          <ZuServer id={sv().id} class="flex items-center gap-1.5 whitespace-nowrap">
            <Icon icon={artIcon(sv().art)} size={14} class="text-muted-foreground" />
            {sv().name}
          </ZuServer>
        </td>
      </Show>
      <ZustandZelle b={props.b} i={props.i} />
      <td class="whitespace-nowrap">
        <Version version={props.i.version} />
        <Show when={!istAktuell(props.b, props.i)}>
          <span class="ml-1 text-xs text-info">
            {props.i.updateLaeuft
              ? m.inst_update_laeuft()
              : m.inst_neue_version({ version: appVon(props.b, props.i.app).version ?? "" })}
          </span>
        </Show>
      </td>
      <td class="text-xs whitespace-nowrap">
        <span class={props.i.backup.ok ? "" : "font-medium text-warn"}>
          {props.i.backup.ok
            ? zeitpunkt(props.i.backup.zeitpunkt, props.b.jetzt)
            : m.inst_backup_alt({ zeit: zeitpunkt(props.i.backup.zeitpunkt, props.b.jetzt) })}
        </span>
        <span class="block text-muted-foreground">
          {m.inst_pruef_restore({ stand: pruefName(props.i) })}
        </span>
      </td>
      <td class="text-right font-mono text-xs whitespace-nowrap tabular-nums">
        {gb(props.i.datenGb)}
      </td>
    </Reihe>
  );
};

const Installationen = () => {
  const b = bestand();
  const [filter, setFilter] = createSignal<Filter>("alle");
  const [gruppe, setGruppe] = createSignal<"server" | "liste">("server");
  const [frage, setFrage] = createSignal("");
  const treffer = createMemo(() => gefiltert(b, filter(), frage()));
  const spalten = () => [
    { name: m.inst_spalte_kunde() },
    { name: m.inst_spalte_app() },
    ...(gruppe() === "liste" ? [{ name: m.server_spalte_server() }] : []),
    { name: m.server_spalte_zustand() },
    { name: m.server_version() },
    { name: m.inst_spalte_backup() },
    { name: m.inst_spalte_daten(), class: "text-right" },
  ];
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Seitenkopf titel={m.nav_installationen()} text={m.inst_text()} />
      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div class="flex max-w-full flex-wrap items-center gap-2">
          <Schalter
            name={m.inst_filter()}
            aktuell={filter()}
            onWahl={setFilter}
            wahl={FILTER.map((f) => ({
              wert: f,
              name: FILTERNAMEN[f](),
              anzahl: b.installationen.filter((i) => passt(b, i, f)).length,
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
      <Tabelle
        name={m.inst_tabelle()}
        minBreite={gruppe() === "liste" ? 1040 : 900}
        leer={m.installationen_keine()}
        anzahl={treffer().length}
        spalten={spalten()}
      >
        <Show
          when={gruppe() === "server"}
          fallback={<For each={treffer()}>{(i) => <Zeile b={b} i={i} mitServer />}</For>}
        >
          <For each={nachServer(b, treffer())}>
            {(g) => (
              <>
                <Zwischenzeile spalten={spalten().length}>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ZuServer id={g.server.id} class="flex items-center gap-2 font-medium">
                      <Icon icon={artIcon(g.server.art)} />
                      {g.server.name}
                    </ZuServer>
                    <ArtZeichen art={g.server.art} />
                    <ServerZeichen zustand={serverZustand(b, g.server)} />
                    <span class="text-xs text-muted-foreground">
                      {g.server.os} · {m.einheit_gb({ wert: g.server.ramGb })} · {g.server.arch} ·{" "}
                      {agentText(b, g.server)}
                    </span>
                  </div>
                </Zwischenzeile>
                <For each={g.installationen}>{(i) => <Zeile b={b} i={i} mitServer={false} />}</For>
              </>
            )}
          </For>
        </Show>
      </Tabelle>
    </div>
  );
};

export const Route = createFileRoute("/installationen/")({ component: Installationen });
