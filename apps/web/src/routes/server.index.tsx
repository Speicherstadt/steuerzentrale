import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Loading, refresh, Show } from "solid-js";
import { betriebsartLesen, nurFuerMich } from "../daten/betriebsart.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { lastGemessen, type ServerZeile, serverZeilen } from "../daten/server-liste.ts";
import { PLATTE_STOERUNG, PLATTE_WARNUNG } from "../daten/zustand.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { ServerHinzufuegen } from "../seiten/server-hinzufuegen.tsx";
import { appsText, StandWorte } from "../seiten/server-zustand.tsx";
import { Mini } from "../teile/balken.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuServer } from "../teile/verweise.tsx";

/**
 * Every server in one table (BAULISTE.md Z-304; docs/plan.md, "Server und Kunden (Oberfläche
 * 2026-11)"): its name and kind in words, its state in words with an icon, CPU and RAM where
 * something measured them (the agent does not report them yet: the demo's values), how full its
 * disk is from the agent's facts, its apps and their customers, and its operating system; what
 * needs attention first, the whole row opens the server. In "Nur für mich" no customers are
 * counted and no kind is named, as every server is the operator's own.
 */

const Leer = () => <span class="text-xs text-muted-foreground">–</span>;

const Last = (props: { name: string; wert: number | null; grenze: number }) => (
  <td>
    <Show when={props.wert !== null} fallback={<Leer />}>
      <Mini name={props.name} wert={props.wert ?? 0} grenze={props.grenze} />
    </Show>
  </td>
);

const Zeile = (props: { z: ServerZeile; mitLast: boolean; fuerKunden: boolean; jetzt: number }) => (
  <Reihe class="relative [&>td]:align-middle">
    <td>
      <ZuServer
        id={props.z.a.id}
        class="block font-medium whitespace-nowrap after:absolute after:inset-0 after:content-['']"
      >
        {props.z.a.name}
      </ZuServer>
    </td>
    <td class="whitespace-nowrap">
      <StandWorte stand={props.z.stand} jetzt={props.jetzt} />
    </td>
    <Show when={props.mitLast}>
      <Last
        name={m.server_cpu_von({ name: props.z.a.name })}
        wert={props.z.cpu}
        grenze={PLATTE_STOERUNG}
      />
      <Last
        name={m.server_ram_von({ name: props.z.a.name })}
        wert={props.z.ram}
        grenze={PLATTE_STOERUNG}
      />
    </Show>
    <Last
      name={m.server_platte_von({ name: props.z.a.name })}
      wert={props.z.a.platte}
      grenze={PLATTE_WARNUNG}
    />
    <td class="whitespace-nowrap">
      {appsText(props.z.apps, props.fuerKunden ? props.z.kunden : null)}
    </td>
    <td class="whitespace-nowrap text-muted-foreground">
      {props.z.a.os ?? m.server_keine_fakten()}
    </td>
  </Reihe>
);

const ServerListe = () => {
  const antwort = createMemo(() => uebersichtLaden());
  const art = createMemo(() => betriebsartLesen());
  const zeilen = createMemo(() => {
    const a = antwort();
    return a.ok ? serverZeilen(bestand(), a.daten.server, a.daten.installationen) : [];
  });
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  const spalten = () => [
    { name: m.server_spalte_server() },
    { name: m.server_spalte_zustand() },
    ...(lastGemessen(zeilen())
      ? [{ name: m.server_spalte_cpu() }, { name: m.server_spalte_ram() }]
      : []),
    { name: m.server_spalte_platte() },
    { name: m.nav_apps() },
    { name: m.server_spalte_system() },
  ];
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Seitenkopf
        titel={m.nav_server()}
        text={m.server_text()}
        aktion={<ServerHinzufuegen onAngelegt={() => refresh(antwort)} />}
      />
      <Loading fallback={<p class="text-muted-foreground">{m.server_laden()}</p>}>
        <Fehler text={fehler()} />
        <Tabelle
          name={m.server_tabelle()}
          minBreite={lastGemessen(zeilen()) ? 1040 : 820}
          leer={m.server_keine()}
          anzahl={zeilen().length}
          spalten={spalten()}
        >
          <For each={zeilen()}>
            {(z) => (
              <Zeile
                z={z}
                mitLast={lastGemessen(zeilen())}
                fuerKunden={!nurFuerMich(art())}
                jetzt={bestand().jetzt}
              />
            )}
          </For>
        </Tabelle>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/server/")({ component: ServerListe });
