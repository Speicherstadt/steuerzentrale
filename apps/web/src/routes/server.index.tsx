import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { installationenAuf, kundenAuf, sperrzeitenAuf } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Server } from "../daten/typen.ts";
import { PLATTE_WARNUNG, serverZustand } from "../daten/zustand.ts";
import { agentText } from "../seiten/server-texte.ts";
import { Mini } from "../teile/balken.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuServer } from "../teile/verweise.tsx";
import { AgentZeichen, ArtZeichen, ServerZeichen } from "../teile/zeichen.tsx";

/** Shared servers, servers of their own and servers at the customer, each with its agent */

const Zeile = (props: { b: Bestand; sv: Server }) => {
  const kunden = () => kundenAuf(props.b, props.sv.id);
  const sperren = () => sperrzeitenAuf(props.b, props.sv.id);
  return (
    <Reihe>
      <td>
        <ZuServer id={props.sv.id}>
          <span class="block font-medium whitespace-nowrap">{props.sv.name}</span>
          <span class="block font-mono text-xs whitespace-nowrap text-muted-foreground">
            {props.sv.host} · {props.sv.os} · {props.sv.arch}
          </span>
        </ZuServer>
      </td>
      <td>
        <ArtZeichen art={props.sv.art} />
      </td>
      <td>
        <AgentZeichen zustand={props.sv.agent.zustand} text={agentText(props.b, props.sv)} />
        <span class="mt-1 block font-mono text-xs text-muted-foreground">
          {m.server_agent_version({ version: props.sv.agent.version })}
        </span>
      </td>
      <td>
        <ServerZeichen zustand={serverZustand(props.b, props.sv)} />
      </td>
      <td class="text-xs">
        <span class="font-medium tabular-nums">
          {m.server_installationen_kunden({
            n: installationenAuf(props.b, props.sv.id).length,
            kunden: kunden().length,
          })}
        </span>
        <span class="block max-w-[180px] truncate text-muted-foreground">
          {kunden()
            .map((k) => k.name)
            .join(", ")}
        </span>
      </td>
      <td>
        <Mini
          name={m.server_ram_von({ name: props.sv.name })}
          wert={props.sv.ram}
          grenze={PLATTE_WARNUNG}
        />
        <span class="text-xs text-muted-foreground">{m.einheit_gb({ wert: props.sv.ramGb })}</span>
      </td>
      <td>
        <Mini
          name={m.server_platte_von({ name: props.sv.name })}
          wert={props.sv.platte}
          grenze={PLATTE_WARNUNG}
        />
      </td>
      <td class="text-xs whitespace-nowrap">
        <Show
          when={props.sv.neustart}
          fallback={
            <span class="text-muted-foreground">
              {props.sv.sicherheitsupdates
                ? m.server_updates_offen({ n: props.sv.sicherheitsupdates })
                : m.server_aktuell()}
            </span>
          }
        >
          <span class="font-medium text-warn">{m.server_zustand_neustart()}</span>
        </Show>
        <span class="block text-muted-foreground">
          {m.server_kernel({ version: props.sv.kernel.laeuft })}
        </span>
      </td>
      <td class="text-xs whitespace-nowrap tabular-nums">
        {props.sv.wartung.von}–{props.sv.wartung.bis}
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
  return (
    <div class="grid gap-6">
      <Seitenkopf titel={m.nav_server()} text={m.server_text()} />
      <Tabelle
        name={m.server_tabelle()}
        minBreite={1120}
        leer={m.server_keine()}
        anzahl={b.server.length}
        spalten={[
          { name: m.server_spalte_server() },
          { name: m.server_spalte_art() },
          { name: m.server_spalte_agent() },
          { name: m.server_spalte_zustand() },
          { name: m.nav_installationen() },
          { name: m.server_spalte_ram() },
          { name: m.server_spalte_platte() },
          { name: m.server_spalte_system() },
          { name: m.server_spalte_wartung() },
        ]}
      >
        <For each={b.server}>{(sv) => <Zeile b={b} sv={sv} />}</For>
      </Tabelle>
    </div>
  );
};

export const Route = createFileRoute("/server/")({ component: ServerListe });
