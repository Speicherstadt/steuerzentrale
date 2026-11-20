import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, Power } from "@steuerzentrale/ui/icons";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import {
  betrifft,
  installationenAuf,
  kundenAuf,
  ramVergebenMb,
  sperrzeitAktiv,
  sperrzeitenAuf,
  suche,
} from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Server } from "../daten/typen.ts";
import { PLATTE_STOERUNG, pruefungen, serverZustand } from "../daten/zustand.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { InstallationsListe } from "../seiten/installations-liste.tsx";
import { agentText, pruefText } from "../seiten/server-texte.ts";
import { Messer } from "../teile/balken.tsx";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Ereignisliste, Pruefzeile } from "../teile/listen.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ArtZeichen, artIcon, ServerZeichen, Zustand } from "../teile/zeichen.tsx";

/** One server: load, system facts, maintenance, the agent's checks, installations, events */

const Kopf = (props: { b: Bestand; sv: Server }) => (
  <div class="flex min-w-0 items-center gap-4">
    <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent">
      <Icon icon={artIcon(props.sv.art)} size={24} />
    </span>
    <div class="grid min-w-0 gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{props.sv.name}</h1>
        <ArtZeichen art={props.sv.art} />
        <ServerZeichen zustand={serverZustand(props.b, props.sv)} />
      </div>
      <p class="font-mono text-xs text-muted-foreground">
        {props.sv.host} · {props.sv.ipv4 || m.server_keine_ip()}
      </p>
    </div>
  </div>
);

const Auslastung = (props: { b: Bestand; sv: Server }) => (
  <Karte>
    <KartenKopf
      titel={m.server_auslastung()}
      text={m.server_auslastung_text({ agent: agentText(props.b, props.sv) })}
    />
    <KartenInhalt class="grid gap-4">
      <Messer name={m.server_cpu()} wert={props.sv.cpu} grenze={PLATTE_STOERUNG} />
      <Messer name={m.server_ram()} wert={props.sv.ram} grenze={PLATTE_STOERUNG} />
      <Messer name={m.server_spalte_platte()} wert={props.sv.platte} grenze={PLATTE_STOERUNG} />
      <p class="text-xs text-muted-foreground">
        {m.server_ram_vergeben({
          vergeben: Math.round(ramVergebenMb(props.b, props.sv.id) / 1024),
          gesamt: props.sv.ramGb,
        })}
      </p>
    </KartenInhalt>
  </Karte>
);

const leer = (wert: string, sonst: string) =>
  wert ? (
    <span class="font-mono text-xs">{wert}</span>
  ) : (
    <span class="text-muted-foreground">{sonst}</span>
  );

const System = (props: { b: Bestand; sv: Server }) => (
  <Karte>
    <KartenKopf titel={m.server_system()} text={m.server_system_text()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.server_anbieter(), wert: props.sv.anbieter },
          { name: m.server_os(), wert: `${props.sv.os}, ${props.sv.arch}` },
          { name: m.pruefung_kernel(), wert: props.sv.kernel.laeuft },
          { name: m.pruefung_podman(), wert: m.server_podman({ version: props.sv.podman }) },
          { name: m.server_ipv4(), wert: leer(props.sv.ipv4, m.server_keine()) },
          { name: m.server_ipv6(), wert: leer(props.sv.ipv6, m.server_keine()) },
          {
            name: m.server_erreichbar(),
            wert:
              props.sv.erreichbar === "pforte"
                ? m.server_erreichbar_pforte()
                : m.server_erreichbar_portweiterleitung(),
          },
          {
            name: m.server_spalte_agent(),
            wert: `${props.sv.agent.version}, ${agentText(props.b, props.sv)}`,
          },
          { name: m.server_laufzeit(), wert: m.server_tage({ n: props.sv.laufzeitTage }) },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const Wartung = (props: { b: Bestand; sv: Server }) => {
  const sperren = () => sperrzeitenAuf(props.b, props.sv.id);
  const geplant = () => props.b.auftraege.find((a) => a.id === props.sv.neustart?.auftrag);
  return (
    <Karte>
      <KartenKopf titel={m.server_wartung()} text={m.server_wartung_text()} />
      <KartenInhalt>
        <Angaben
          zeilen={[
            {
              name: m.server_spalte_wartung(),
              wert: m.server_taeglich({ von: props.sv.wartung.von, bis: props.sv.wartung.bis }),
            },
            {
              name: m.server_sperrzeiten_hier(),
              wert: sperren().length
                ? sperren()
                    .map((z) => m.server_sperrzeit_tage({ app: z.appName, von: z.von, bis: z.bis }))
                    .join(", ")
                : m.server_keine(),
            },
            {
              name: m.server_gesperrt(),
              wert: sperren().some((z) => sperrzeitAktiv(z, props.b.jetzt)) ? m.ja() : m.nein(),
            },
            {
              name: m.server_naechster_neustart(),
              wert: geplant()
                ? m.server_neustart_auftrag({
                    zeit: zeitpunkt(geplant()?.start ?? 0, props.b.jetzt),
                    id: geplant()?.id ?? "",
                  })
                : m.server_kein_neustart(),
            },
          ]}
        />
        <p class="mt-4 text-xs text-muted-foreground">{m.server_neustart_regel()}</p>
      </KartenInhalt>
    </Karte>
  );
};

const Neustart = (props: { sv: Server }) => (
  <Show when={props.sv.neustart}>
    {(n) => (
      <Karte class="overflow-hidden">
        <KartenKopf titel={m.server_ausstehend()} text={m.server_ausstehend_text()} />
        <div class="border-t">
          <Tabelle
            name={m.server_ausstehend()}
            rahmen={false}
            minBreite={480}
            leer=""
            anzahl={n().pakete.length}
            spalten={[
              { name: m.server_paket() },
              { name: m.server_version() },
              { name: m.server_stand() },
            ]}
          >
            <For each={n().pakete}>
              {(p) => (
                <Reihe>
                  <td class="font-mono text-xs">{p.name}</td>
                  <td class="font-mono text-xs">{p.version}</td>
                  <td>
                    <Show
                      when={p.wartet}
                      fallback={
                        <Zustand icon={CircleCheck} farbe="text-ok" text={m.server_eingespielt()} />
                      }
                    >
                      <Zustand icon={Power} farbe="text-warn" text={m.server_zustand_neustart()} />
                    </Show>
                  </td>
                </Reihe>
              )}
            </For>
          </Tabelle>
        </div>
      </Karte>
    )}
  </Show>
);

const Detail = (props: { sv: Server }) => {
  const b = bestand();
  const installationen = () => installationenAuf(b, props.sv.id);
  const ids = () => new Set([props.sv.id, ...installationen().map((i) => i.id)]);
  // A silent agent's last values are no check: no OK and no warning, as on the installation page
  const still = () => props.sv.agent.zustand !== "verbunden";
  return (
    <div class="grid gap-4">
      <Kopf b={b} sv={props.sv} />
      <div class="grid gap-4 lg:grid-cols-3">
        <Auslastung b={b} sv={props.sv} />
        <System b={b} sv={props.sv} />
        <Wartung b={b} sv={props.sv} />
      </div>
      <Karte>
        <KartenKopf
          titel={m.server_pruefungen()}
          text={still() ? m.inst_units_still() : m.server_pruefungen_text()}
        />
        <KartenInhalt class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <For each={pruefungen(b, props.sv)}>
            {(p) => <Pruefzeile {...pruefText(b, p)} ok={still() ? null : p.ok} />}
          </For>
        </KartenInhalt>
      </Karte>
      <div class="grid gap-4 lg:grid-cols-2">
        <Karte>
          <KartenKopf
            titel={m.nav_installationen()}
            text={m.server_installationen_text({
              n: installationen().length,
              kunden: kundenAuf(b, props.sv.id).length,
            })}
          />
          <KartenInhalt>
            <InstallationsListe installationen={installationen()} zeige="kunde" />
          </KartenInhalt>
        </Karte>
        <Karte>
          <KartenKopf titel={m.nav_ereignisse()} />
          <KartenInhalt>
            <Ereignisliste ereignisse={b.ereignisse.filter((e) => betrifft(e.ziel, ids()))} />
          </KartenInhalt>
        </Karte>
      </div>
      <Neustart sv={props.sv} />
    </div>
  );
};

const ServerSeite = () => {
  const sv = Route.useLoaderData();
  return <Detail sv={sv()} />;
};

export const Route = createFileRoute("/server/$id")({
  loader: ({ params }) => {
    const sv = suche(bestand().server, params.id);
    if (!sv) throw notFound();
    return sv;
  },
  component: ServerSeite,
});
