import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Loading, refresh, Show } from "solid-js";
import { sperrzeitenDer } from "../daten/ableitungen.ts";
import { aufServer, einmal, type InstallationAnsicht } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { ansichtZustand, type ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand } from "../daten/typen.ts";
import { PLATTE_WARNUNG } from "../daten/zustand.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { ServerHinzufuegen } from "../seiten/server-hinzufuegen.tsx";
import { agentText } from "../seiten/server-texte.ts";
import { Mini } from "../teile/balken.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuServer } from "../teile/verweise.tsx";
import { AgentZeichen, ArtZeichen, ServerZeichen } from "../teile/zeichen.tsx";

/**
 * Shared servers, servers of their own and servers at the customer, each with its agent and its
 * facts (BAULISTE.md Z-304) and the installations on it (Z-406), all from the Zentrale; the freeze
 * windows from the descriptions of the installed apps, the load only in the demo (Z-702).
 */

const Leer = () => <span class="text-xs text-muted-foreground">–</span>;

const System = (props: { a: ServerAnsicht }) => (
  <>
    <Show
      when={props.a.neustart}
      fallback={
        <span class="text-muted-foreground">
          {props.a.updates === null
            ? m.server_unbekannt()
            : props.a.updates
              ? m.server_updates_offen({ n: props.a.updates })
              : m.server_aktuell()}
        </span>
      }
    >
      <span class="font-medium text-warn">{m.server_zustand_neustart()}</span>
    </Show>
    <Show when={props.a.kernel.laeuft}>
      {(k) => <span class="block text-muted-foreground">{m.server_kernel({ version: k() })}</span>}
    </Show>
  </>
);

const Zeile = (props: { b: Bestand; a: ServerAnsicht; installationen: InstallationAnsicht[] }) => {
  const hier = () => aufServer(props.installationen, props.a.id);
  const kunden = () => einmal(hier().map((i) => i.kundeName));
  const sperren = () =>
    sperrzeitenDer(
      props.b,
      hier().map((i) => i.app),
    );
  const unterzeile = () =>
    [props.a.host, props.a.os, props.a.arch].filter(Boolean).join(" · ") || m.server_keine_fakten();
  return (
    <Reihe>
      <td>
        <ZuServer id={props.a.id}>
          <span class="block font-medium whitespace-nowrap">{props.a.name}</span>
          <span class="block font-mono text-xs whitespace-nowrap text-muted-foreground">
            {unterzeile()}
          </span>
        </ZuServer>
      </td>
      <td>
        <ArtZeichen art={props.a.art} />
      </td>
      <td>
        <AgentZeichen zustand={props.a.agent.zustand} text={agentText(props.b, props.a)} />
        <Show when={props.a.agent.version}>
          {(v) => (
            <span class="mt-1 block font-mono text-xs text-muted-foreground">
              {m.server_agent_version({ version: v() })}
            </span>
          )}
        </Show>
      </td>
      <td>
        <ServerZeichen zustand={ansichtZustand(props.b, props.a)} />
      </td>
      <td class="text-xs">
        <span class="font-medium tabular-nums">
          {m.server_installationen_kunden({
            n: hier().length,
            kunden: kunden().length,
          })}
        </span>
        <span class="block max-w-[180px] truncate text-muted-foreground">
          {kunden().join(", ")}
        </span>
      </td>
      <td>
        <Show when={props.a.demo}>
          {(d) => (
            <Mini
              name={m.server_ram_von({ name: props.a.name })}
              wert={d().ram}
              grenze={PLATTE_WARNUNG}
            />
          )}
        </Show>
        <Show when={props.a.ramGb} fallback={<Leer />}>
          {(gb) => (
            <span class="text-xs text-muted-foreground">{m.einheit_gb({ wert: gb() })}</span>
          )}
        </Show>
      </td>
      <td>
        <Show when={props.a.platte !== null} fallback={<Leer />}>
          <Mini
            name={m.server_platte_von({ name: props.a.name })}
            wert={props.a.platte ?? 0}
            grenze={PLATTE_WARNUNG}
          />
        </Show>
      </td>
      <td class="text-xs whitespace-nowrap">
        <System a={props.a} />
      </td>
      <td class="text-xs whitespace-nowrap tabular-nums">
        {props.a.wartung.von}–{props.a.wartung.bis}
        <Show when={sperren().length > 0}>
          <span class="block text-muted-foreground">
            {m.server_sperrzeit({
              apps: sperren()
                .map((z) => z.appName)
                .join(", "),
            })}
          </span>
        </Show>
      </td>
    </Reihe>
  );
};

const ServerListe = () => {
  const b = bestand();
  const antwort = createMemo(() => uebersichtLaden());
  const daten = () => {
    const a = antwort();
    return a.ok ? a.daten : { installationen: [], server: [] };
  };
  const liste = () => daten().server;
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <div class="grid gap-6">
      <Seitenkopf
        titel={m.nav_server()}
        text={m.server_text()}
        aktion={<ServerHinzufuegen onAngelegt={() => refresh(antwort)} />}
      />
      <Loading fallback={<p class="text-muted-foreground">{m.server_laden()}</p>}>
        <Fehler text={fehler()} />
        <Tabelle
          name={m.server_tabelle()}
          minBreite={1120}
          leer={m.server_keine()}
          anzahl={liste().length}
          spalten={[
            { name: m.server_spalte_server() },
            { name: m.server_spalte_art() },
            { name: m.server_spalte_agent() },
            { name: m.server_spalte_zustand() },
            { name: m.nav_apps() },
            { name: m.server_spalte_ram() },
            { name: m.server_spalte_platte() },
            { name: m.server_spalte_system() },
            { name: m.server_spalte_wartung() },
          ]}
        >
          <For each={liste()}>
            {(a) => <Zeile b={b} a={a} installationen={daten().installationen} />}
          </For>
        </Tabelle>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/server/")({ component: ServerListe });
