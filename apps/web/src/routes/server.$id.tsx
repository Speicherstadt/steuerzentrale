import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, Power } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Loading, Match, Show, Switch } from "solid-js";
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
import { serverQuelle } from "../daten/server.ts";
import { ansichtZustand, type ServerAnsicht, serverAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand, Server } from "../daten/typen.ts";
import { PLATTE_STOERUNG, pruefungen } from "../daten/zustand.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { InstallationsListe } from "../seiten/installations-liste.tsx";
import { agentText, pruefText } from "../seiten/server-texte.ts";
import { Messer } from "../teile/balken.tsx";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Ereignisliste, Pruefzeile } from "../teile/listen.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ArtZeichen, artIcon, ServerZeichen, Zustand } from "../teile/zeichen.tsx";

/**
 * One server: its facts from the agent (BAULISTE.md Z-304), maintenance, installations and events.
 * The server comes from the Zentrale (src/daten/server.ts); load, the checks, the reboot job and
 * the installations still from the demo data by id until their items, so a server of the Zentrale
 * shows its facts and none of those yet.
 */

const Kopf = (props: { b: Bestand; a: ServerAnsicht }) => (
  <div class="flex min-w-0 items-center gap-4">
    <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent">
      <Icon icon={artIcon(props.a.art)} size={24} />
    </span>
    <div class="grid min-w-0 gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{props.a.name}</h1>
        <ArtZeichen art={props.a.art} />
        <ServerZeichen zustand={ansichtZustand(props.b, props.a)} />
      </div>
      <p class="font-mono text-xs text-muted-foreground">
        {[props.a.host, props.a.ipv4?.[0] ?? m.server_keine_ip()].filter(Boolean).join(" · ")}
      </p>
    </div>
  </div>
);

const Auslastung = (props: { b: Bestand; a: ServerAnsicht }) => (
  <Karte>
    <KartenKopf
      titel={m.server_auslastung()}
      text={m.server_auslastung_text({ agent: agentText(props.b, props.a) })}
    />
    <KartenInhalt class="grid gap-4">
      <Show when={props.a.demo}>
        {(d) => (
          <>
            <Messer name={m.server_cpu()} wert={d().cpu} grenze={PLATTE_STOERUNG} />
            <Messer name={m.server_ram()} wert={d().ram} grenze={PLATTE_STOERUNG} />
          </>
        )}
      </Show>
      <For
        each={props.a.platten ?? []}
        fallback={<p class="text-sm text-muted-foreground">{m.server_keine_fakten_text()}</p>}
      >
        {(p) => (
          <Messer
            name={
              props.a.platten?.length === 1
                ? m.server_spalte_platte()
                : m.server_platte_mount({ mount: p.mount })
            }
            wert={p.prozent}
            grenze={PLATTE_STOERUNG}
          />
        )}
      </For>
      <Show when={props.a.ramGb}>
        {(gb) => (
          <p class="text-xs text-muted-foreground">
            {m.server_ram_vergeben({
              vergeben: Math.round(ramVergebenMb(props.b, props.a.id) / 1024),
              gesamt: gb(),
            })}
          </p>
        )}
      </Show>
    </KartenInhalt>
  </Karte>
);

const leer = (wert: string | null | undefined, sonst: string) =>
  wert ? (
    <span class="font-mono text-xs">{wert}</span>
  ) : (
    <span class="text-muted-foreground">{sonst}</span>
  );

const liste = (werte: string[] | null) =>
  werte === null ? leer(null, m.server_unbekannt()) : leer(werte.join(", "), m.server_keine());

const kernelText = (k: ServerAnsicht["kernel"]) =>
  k.installiert && k.laeuft && k.installiert !== k.laeuft
    ? m.server_kernel_installiert({ laeuft: k.laeuft, installiert: k.installiert })
    : k.laeuft;

const port25Text = (offen: boolean | null) =>
  offen === null ? null : offen ? m.server_port25_offen() : m.server_port25_gesperrt();

const systemZeilen = (b: Bestand, a: ServerAnsicht) => {
  const unbekannt = m.server_unbekannt();
  const ptr = Object.entries(a.ptr).map(([ip, name]) => `${ip} → ${name}`);
  return [
    ...(a.demo ? [{ name: m.server_anbieter(), wert: a.demo.anbieter }] : []),
    { name: m.server_os(), wert: leer([a.os, a.arch].filter(Boolean).join(", "), unbekannt) },
    { name: m.pruefung_kernel(), wert: leer(kernelText(a.kernel), unbekannt) },
    {
      name: m.pruefung_podman(),
      wert: leer(a.podman && m.server_podman({ version: a.podman }), unbekannt),
    },
    { name: m.server_cpu_kerne(), wert: leer(a.cpuKerne?.toString(), unbekannt) },
    {
      name: m.server_ram(),
      wert: leer(a.ramGb ? m.einheit_gb({ wert: a.ramGb }) : null, unbekannt),
    },
    { name: m.server_ipv4(), wert: liste(a.ipv4) },
    { name: m.server_ipv6(), wert: liste(a.ipv6) },
    { name: m.server_ptr(), wert: leer(ptr.join(", "), m.server_keine()) },
    { name: m.server_port25(), wert: leer(port25Text(a.port25), unbekannt) },
    { name: m.server_ports(), wert: liste(a.ports) },
    ...(a.demo
      ? [
          {
            name: m.server_erreichbar(),
            wert:
              a.demo.erreichbar === "pforte"
                ? m.server_erreichbar_pforte()
                : m.server_erreichbar_portweiterleitung(),
          },
        ]
      : []),
    {
      name: m.server_spalte_agent(),
      wert: [a.agent.version, agentText(b, a)].filter(Boolean).join(", "),
    },
    {
      name: m.server_fakten_am(),
      wert: a.faktenAm === null ? m.server_keine_fakten() : zeitpunkt(a.faktenAm, b.jetzt),
    },
  ];
};

const System = (props: { b: Bestand; a: ServerAnsicht }) => (
  <Karte>
    <KartenKopf titel={m.server_system()} text={m.server_system_text()} />
    <KartenInhalt>
      <Angaben zeilen={systemZeilen(props.b, props.a)} />
    </KartenInhalt>
  </Karte>
);

const Wartung = (props: { b: Bestand; a: ServerAnsicht }) => {
  const sperren = () => sperrzeitenAuf(props.b, props.a.id);
  const geplant = () => props.b.auftraege.find((a) => a.id === props.a.demo?.neustart?.auftrag);
  return (
    <Karte>
      <KartenKopf titel={m.server_wartung()} text={m.server_wartung_text()} />
      <KartenInhalt>
        <Angaben
          zeilen={[
            {
              name: m.server_spalte_wartung(),
              wert: m.server_taeglich({ von: props.a.wartung.von, bis: props.a.wartung.bis }),
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

/** The agent's checks; they come from the demo data until Z-702 */
const Pruefungen = (props: { b: Bestand; sv: Server; still: boolean }) => (
  <Karte>
    <KartenKopf
      titel={m.server_pruefungen()}
      text={props.still ? m.inst_units_still() : m.server_pruefungen_text()}
    />
    <KartenInhalt class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <For each={pruefungen(props.b, props.sv)}>
        {(p) => <Pruefzeile {...pruefText(props.b, p)} ok={props.still ? null : p.ok} />}
      </For>
    </KartenInhalt>
  </Karte>
);

const Detail = (props: { a: ServerAnsicht }) => {
  const b = bestand();
  const installationen = () => installationenAuf(b, props.a.id);
  const ids = () => new Set([props.a.id, ...installationen().map((i) => i.id)]);
  // A silent agent's last values are no check: no OK and no warning, as on the installation page
  const still = () => props.a.agent.zustand !== "verbunden";
  return (
    <div class="grid gap-4">
      <Kopf b={b} a={props.a} />
      <div class="grid gap-4 lg:grid-cols-3">
        <Auslastung b={b} a={props.a} />
        <System b={b} a={props.a} />
        <Wartung b={b} a={props.a} />
      </div>
      <Show when={props.a.demo}>{(d) => <Pruefungen b={b} sv={d()} still={still()} />}</Show>
      <div class="grid gap-4 lg:grid-cols-2">
        <Karte>
          <KartenKopf
            titel={m.nav_installationen()}
            text={m.server_installationen_text({
              n: installationen().length,
              kunden: kundenAuf(b, props.a.id).length,
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
      <Show when={props.a.demo}>{(d) => <Neustart sv={d()} />}</Show>
    </div>
  );
};

const ServerSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(() => serverQuelle().server(params().id));
  const ansicht = () => {
    const a = antwort();
    return a.ok ? serverAnsicht(a.daten, suche(bestand().server, a.daten.serverId)) : undefined;
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
    <Loading fallback={<p class="text-muted-foreground">{m.server_laden()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={ansicht()}>{(a) => <Detail a={a()} />}</Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/server/$id")({ component: ServerSeite });
