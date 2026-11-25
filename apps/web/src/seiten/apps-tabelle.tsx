import { Icon, m } from "@steuerzentrale/ui";
import {
  CircleArrowUp,
  CircleCheck,
  CircleHelp,
  CircleX,
  type IconNode,
  LoaderCircle,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import { For, Match, Show, Switch } from "solid-js";
import { type AppZeile, type AppZustand, type Gruppe, stufeVon } from "../daten/apps-liste.ts";
import { grundText } from "../daten/bewertung.ts";
import { prozent, speicher } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Reihe, Tabelle, Zwischenzeile } from "../teile/tabelle.tsx";
import { ZuInstallation, ZuKunde, ZuServer } from "../teile/verweise.tsx";

/*
 * The table of the page "Apps" (docs/plan.md, "Navigation (Oberfläche 2026-11)"): per app its
 * icon and name, the customer, its state in plain words with an icon, the version with an update
 * under way or offered, the last backup, CPU and memory of its Linux user (Z-1106) and the server; the whole row opens the app. Grouped, a grey
 * row names the customer or server above its apps.
 */

/** The state in the words of the column, from its data (daten/apps-liste.ts) */
export const zustandText = (z: AppZustand): string => {
  switch (z.art) {
    case "gescheitert":
      return m.inst_zustand_gescheitert();
    case "stoerung":
      return m.hinweis_stoerung({ grund: grundText(z.grund) });
    case "backup_alt":
      return z.tage < 2 ? m.apps_z_backup_alt_eins() : m.apps_z_backup_alt({ tage: z.tage });
    case "backup_gescheitert":
      return m.apps_z_backup_gescheitert();
    case "pruef_gescheitert":
      return m.apps_z_pruef_gescheitert();
    case "warnung":
    case "unbekannt":
      return grundText(z.grund);
    case "wird_eingerichtet":
      return m.inst_zustand_wird_eingerichtet();
    case "aktualisiert":
      return m.apps_z_aktualisiert();
    case "laeuft":
      return m.apps_z_laeuft();
  }
};

const ZEICHEN: Record<ReturnType<typeof stufeVon>, { icon: IconNode; farbe: string }> = {
  rot: { icon: CircleX, farbe: "text-destructive" },
  gelb: { icon: TriangleAlert, farbe: "text-warn" },
  unbekannt: { icon: CircleHelp, farbe: "text-muted-foreground" },
  unterwegs: { icon: LoaderCircle, farbe: "text-muted-foreground" },
  gut: { icon: CircleCheck, farbe: "text-ok" },
};

/** The text in the colour of its state; what runs well stays grey */
const TEXT: Record<ReturnType<typeof stufeVon>, string> = {
  rot: "text-destructive",
  gelb: "text-warn",
  unbekannt: "",
  unterwegs: "",
  gut: "text-muted-foreground",
};

/** The icon of a state alone, where its words stand elsewhere or are not needed */
export const ZustandIcon = (props: { z: AppZustand }) => (
  <Icon
    icon={ZEICHEN[stufeVon(props.z)].icon}
    size={15}
    class={`shrink-0 ${ZEICHEN[stufeVon(props.z)].farbe}`}
  />
);

/**
 * Icon and words of a state; the icon repeats the words, so it is hidden from screen readers.
 * `satz`: the head of an app's page, where a well-running app says so in a sentence
 */
export const ZustandWorte = (props: { z: AppZustand; satz?: string }) => (
  <span class="inline-flex items-center gap-1.5">
    <ZustandIcon z={props.z} />
    <span class={props.satz ? "" : TEXT[stufeVon(props.z)]}>
      {props.satz ?? zustandText(props.z)}
    </span>
  </span>
);

/** The installed version, "→ new" while an update runs, a mark "↑ new" while one is offered */
const VersionZelle = (props: { z: AppZeile }) => (
  <td class="font-mono text-xs whitespace-nowrap">
    <span class="inline-flex items-center gap-2">
      <span>{props.z.a.version}</span>
      <Show when={props.z.ziel}>{(ziel) => <span>→ {ziel()}</span>}</Show>
      <Show when={props.z.angeboten}>
        {(v) => (
          <span
            title={m.apps_update_angeboten({ version: v() })}
            class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-muted-foreground"
          >
            <Icon
              icon={CircleArrowUp}
              size={12}
              label={m.apps_update_angeboten({ version: v() })}
            />
            {v()}
          </span>
        )}
      </Show>
    </span>
  </td>
);

const KundeZelle = (props: { z: AppZeile }) => (
  <td>
    {props.z.a.kundeName}
    <Switch>
      <Match when={props.z.a.vertragsende}>
        {(ende) => (
          <span class="text-muted-foreground">
            {" · "}
            {m.apps_gekuendigt({ datum: datum(ende()) })}
          </span>
        )}
      </Match>
      <Match when={props.z.a.kundeIntern}>
        <span class="text-muted-foreground">
          {" · "}
          {m.apps_eigene()}
        </span>
      </Match>
    </Switch>
  </td>
);

/** One app; its name is the link, and the link covers the row, so a click anywhere opens it */
const Zeile = (props: { z: AppZeile; mitKunde: boolean; mitLast: boolean; jetzt: number }) => (
  <Reihe class="relative [&>td]:align-middle">
    <td>
      <ZuInstallation
        id={props.z.a.id}
        class="flex items-center gap-2.5 font-medium after:absolute after:inset-0 after:content-['']"
      >
        <span class="flex size-7 shrink-0 items-center justify-center rounded-md border">
          <Icon icon={appIcon(props.z.a.appIcon)} size={15} />
        </span>
        {props.z.a.appName}
      </ZuInstallation>
    </td>
    <Show when={props.mitKunde}>
      <KundeZelle z={props.z} />
    </Show>
    <td>
      <ZustandWorte z={props.z.zustand} />
    </td>
    <VersionZelle z={props.z} />
    <td
      class={[
        "text-xs whitespace-nowrap",
        props.z.backup?.alt ? "text-warn" : "text-muted-foreground",
      ]}
    >
      {props.z.backup ? zeitpunkt(props.z.backup.zeitpunkt, props.jetzt) : "–"}
    </td>
    <Show when={props.mitLast}>
      <td class="whitespace-nowrap text-right tabular-nums text-muted-foreground">
        {props.z.cpu === null ? "–" : prozent(props.z.cpu, props.z.cpu % 1 ? 1 : 0)}
      </td>
      <td class="whitespace-nowrap text-right tabular-nums text-muted-foreground">
        {props.z.ramMb === null ? "–" : speicher(props.z.ramMb)}
      </td>
    </Show>
    <td class="whitespace-nowrap text-muted-foreground">{props.z.a.serverName}</td>
  </Reihe>
);

const Gruppenkopf = (props: { g: Gruppe; spalten: number }) => (
  <Zwischenzeile spalten={props.spalten}>
    <Show
      when={props.g.art === "server"}
      fallback={
        <ZuKunde id={props.g.id} class="font-medium">
          {props.g.name}
        </ZuKunde>
      }
    >
      <ZuServer id={props.g.id} class="font-medium">
        {props.g.name}
      </ZuServer>
    </Show>
    <span class="ml-2 text-xs text-muted-foreground">
      {m.apps_anzahl({ anzahl: props.g.zeilen.length })}
    </span>
  </Zwischenzeile>
);

/** The table: the rows as they come, or under the heads of their groups */
export const AppsTabelle = (props: {
  zeilen: AppZeile[];
  gruppen: Gruppe[] | null;
  mitKunde: boolean;
  jetzt: number;
}) => {
  const mitLast = () => props.zeilen.some((z) => z.cpu !== null || z.ramMb !== null);
  const spalten = () => [
    { name: m.inst_spalte_app() },
    ...(props.mitKunde ? [{ name: m.inst_spalte_kunde() }] : []),
    { name: m.server_spalte_zustand() },
    { name: m.server_version() },
    { name: m.apps_spalte_backup() },
    // Z-1106: once any app's server reported them
    ...(mitLast()
      ? [
          { name: m.server_spalte_cpu(), class: "text-right" },
          { name: m.server_spalte_ram(), class: "text-right" },
        ]
      : []),
    { name: m.server_spalte_server() },
  ];
  return (
    <Tabelle
      name={m.inst_tabelle()}
      minBreite={props.mitKunde ? 1000 : 820}
      leer={m.installationen_keine()}
      anzahl={props.zeilen.length}
      spalten={spalten()}
    >
      <Show
        when={props.gruppen}
        fallback={
          <For each={props.zeilen}>
            {(z) => (
              <Zeile z={z} mitKunde={props.mitKunde} mitLast={mitLast()} jetzt={props.jetzt} />
            )}
          </For>
        }
      >
        {(gruppen) => (
          <For each={gruppen()}>
            {(g) => (
              <>
                <Gruppenkopf g={g} spalten={spalten().length} />
                <For each={g.zeilen}>
                  {(z) => (
                    <Zeile
                      z={z}
                      mitKunde={props.mitKunde}
                      mitLast={mitLast()}
                      jetzt={props.jetzt}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        )}
      </Show>
    </Tabelle>
  );
};
