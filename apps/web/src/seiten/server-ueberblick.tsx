import { m } from "@steuerzentrale/ui";
import { Activity, CircleCheck, Clock, RefreshCw, ShieldCheck } from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import type { AppZeile } from "../daten/apps-liste.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand } from "../daten/typen.ts";
import { PLATTE_STOERUNG, PLATTE_WARNUNG } from "../daten/zustand.ts";
import { datum } from "../format/zeit.ts";
import { Mini } from "../teile/balken.tsx";
import { Karte } from "../teile/karte.tsx";
import { Punkt, Urteil } from "../teile/punkte.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { ZustandIcon, zustandText } from "./apps-tabelle.tsx";
import { agentStill, type PruefZeile, pruefZeilen } from "./server-technik.tsx";
import { agentText } from "./server-texte.ts";
import { Zuletzt } from "./zuletzt.tsx";

/*
 * The tab "Überblick" of a server (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): five
 * rows, each from its source and nothing invented: how full it is (the disk from the agent's
 * facts, CPU and RAM only where measured: the demo's values), its operating system (Z-701), its
 * maintenance window, its checks (Z-702) and its agent with its certificate (Z-303); beside them
 * its first apps with their state and the newest of its events (Z-406).
 */

type Hier = { b: Bestand; a: ServerAnsicht };

const LastWert = (props: { name: string; label: string; wert: number; grenze: number }) => (
  <span class="inline-flex items-center gap-2 text-xs">
    <span class="text-muted-foreground">{props.label}</span>
    <Mini name={props.name} wert={props.wert} grenze={props.grenze} />
  </span>
);

const Auslastung = (props: Hier) => (
  <Punkt
    icon={Activity}
    titel={m.server_auslastung()}
    text={
      props.a.faktenAm === null
        ? m.server_keine_fakten_text()
        : m.server_auslastung_text({ agent: agentText(props.b, props.a) })
    }
    testid="auslastung"
    rechts={
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <Show when={props.a.demo}>
          {(d) => (
            <>
              <LastWert
                label={m.server_spalte_cpu()}
                name={m.server_cpu_von({ name: props.a.name })}
                wert={d().cpu}
                grenze={PLATTE_STOERUNG}
              />
              <LastWert
                label={m.server_spalte_ram()}
                name={m.server_ram_von({ name: props.a.name })}
                wert={d().ram}
                grenze={PLATTE_STOERUNG}
              />
            </>
          )}
        </Show>
        <Show when={props.a.platte !== null}>
          <LastWert
            label={m.server_spalte_platte()}
            name={m.server_platte_von({ name: props.a.name })}
            wert={props.a.platte ?? 0}
            grenze={PLATTE_WARNUNG}
          />
        </Show>
      </div>
    }
  />
);

const systemText = (a: ServerAnsicht): string =>
  [
    a.os ?? m.server_unbekannt(),
    ...(a.updates === null
      ? []
      : [a.updates === 0 ? m.server_updates_aktuell() : m.server_updates_offen({ n: a.updates })]),
    ...(a.neustart === null
      ? []
      : [a.neustart ? m.server_zustand_neustart() : m.server_kein_neustart_noetig()]),
  ].join(" · ");

const systemOk = (a: ServerAnsicht): boolean | null =>
  a.updates === null || a.neustart === null ? null : a.updates === 0 && !a.neustart;

/** All well with how many and their names, or what is not, each with what it measured */
const pruefText = (zeilen: PruefZeile[], still: boolean): string => {
  if (still) return m.inst_units_still();
  if (zeilen.length === 0) return m.server_pruefungen_keine();
  const auffaellig = zeilen.filter((z) => z.ok === false);
  if (auffaellig.length > 0) return auffaellig.map((z) => `${z.name}: ${z.detail}`).join(" · ");
  return m.server_pruefungen_gut({
    n: zeilen.filter((z) => z.ok === true).length,
    von: zeilen.length,
    namen: zeilen.map((z) => z.name).join(", "),
  });
};

const Pruefungen = (props: Hier) => {
  const zeilen = () => pruefZeilen(props.a, props.b.jetzt, agentStill(props.a));
  const ok = () =>
    agentStill(props.a) || zeilen().every((z) => z.ok === null)
      ? null
      : zeilen().every((z) => z.ok !== false);
  return (
    <Punkt
      icon={CircleCheck}
      titel={m.server_pruefungen()}
      text={pruefText(zeilen(), agentStill(props.a))}
      testid="pruefungen"
      rechts={<Urteil ok={ok()} />}
    />
  );
};

const Agent = (props: Hier) => (
  <Punkt
    icon={ShieldCheck}
    titel={
      props.a.agent.version
        ? m.server_agent_version({ version: props.a.agent.version })
        : m.server_spalte_agent()
    }
    text={[
      agentText(props.b, props.a),
      ...(props.a.zertifikatBis === null
        ? []
        : [m.server_zertifikat_bis({ datum: datum(props.a.zertifikatBis) })]),
    ].join(" · ")}
    testid="agent"
    rechts={
      <Urteil
        ok={props.a.agent.letzteMeldung === null ? null : props.a.agent.zustand === "verbunden"}
      />
    }
  />
);

const Zeilen = (props: Hier) => (
  <Karte>
    <ul class="divide-y px-5">
      <Auslastung b={props.b} a={props.a} />
      <Punkt
        icon={RefreshCw}
        titel={m.server_os()}
        text={systemText(props.a)}
        testid="system"
        rechts={<Urteil ok={systemOk(props.a)} />}
      />
      <Punkt
        icon={Clock}
        titel={m.server_wartungsfenster({ von: props.a.wartung.von, bis: props.a.wartung.bis })}
        text={m.server_wartung_regel()}
        testid="wartung"
      />
      <Pruefungen b={props.b} a={props.a} />
      <Agent b={props.b} a={props.a} />
    </ul>
  </Karte>
);

/** How many apps the card shows before "Alle … Apps" */
const ERSTE = 4;

const AppsKarte = (props: { a: ServerAnsicht; zeilen: AppZeile[] }) => (
  <Karte>
    <div class="grid gap-1 p-5 pb-2">
      <h2 class="font-semibold leading-none">{m.server_apps_hier()}</h2>
    </div>
    <ul class="divide-y px-5" data-testid="apps-hier">
      <For
        each={props.zeilen.slice(0, ERSTE)}
        fallback={<li class="py-3 text-muted-foreground">{m.installationen_keine()}</li>}
      >
        {(z) => (
          <li class="flex items-center gap-3 py-3">
            <ZustandIcon z={z.zustand} />
            <ZuInstallation id={z.a.id} class="min-w-0 flex-1 truncate">
              <span class="font-medium">{z.a.appName}</span>
              <span class="text-muted-foreground"> · {z.a.kundeName}</span>
            </ZuInstallation>
            <Show when={z.stufe !== "gut"}>
              <span class="shrink-0 text-xs text-muted-foreground">{zustandText(z.zustand)}</span>
            </Show>
          </li>
        )}
      </For>
    </ul>
    <div class="border-t px-5 py-3">
      <Link
        to="/server/$id"
        params={{ id: props.a.id }}
        search={{ tab: "apps" }}
        class="underline underline-offset-4"
      >
        {m.server_alle_apps({ n: props.zeilen.length })}
      </Link>
    </div>
  </Karte>
);

export const ServerUeberblick = (props: Hier & { zeilen: AppZeile[] }) => (
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <Zeilen b={props.b} a={props.a} />
    <div class="grid gap-4">
      <AppsKarte a={props.a} zeilen={props.zeilen} />
      <Zuletzt
        ziele={[`server:${props.a.id}`, ...props.zeilen.map((z) => `installation:${z.a.id}`)]}
        link={
          <Link
            to="/server/$id"
            params={{ id: props.a.id }}
            search={{ tab: "verlauf" }}
            class="underline underline-offset-4"
          >
            {m.app_ganzer_verlauf()}
          </Link>
        }
      />
    </div>
  </div>
);
