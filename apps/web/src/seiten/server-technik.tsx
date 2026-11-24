import { m } from "@steuerzentrale/ui";
import { CircleCheck, Power } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import { ramDerMb } from "../daten/ableitungen.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand, Server } from "../daten/typen.ts";
import { auffaellig, pruefungen } from "../daten/zustand.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Pruefzeile } from "../teile/listen.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Zustand } from "../teile/zeichen.tsx";
import { agentText, type PruefText, pruefText, serverPruefungText } from "./server-texte.ts";
import { Wartung } from "./server-wartung.tsx";

/*
 * The tab "Technik" of a server's page (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"):
 * what the page showed before, once. Its facts from the agent with its certificate (Z-304), its
 * operating system, maintenance window and reboot (Z-701), every check (Z-702) and, in the demo
 * only, the packages that wait for a reboot.
 */

export type Hier = { b: Bestand; a: ServerAnsicht; apps: string[] };

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

const netzZeilen = (a: ServerAnsicht) => {
  const ptr = Object.entries(a.ptr).map(([ip, name]) => `${ip} → ${name}`);
  return [
    { name: m.server_ipv4(), wert: liste(a.ipv4) },
    { name: m.server_ipv6(), wert: liste(a.ipv6) },
    { name: m.server_ptr(), wert: leer(ptr.join(", "), m.server_keine()) },
    { name: m.server_port25(), wert: leer(port25Text(a.port25), m.server_unbekannt()) },
    { name: m.server_ports(), wert: liste(a.ports) },
  ];
};

const systemZeilen = (b: Bestand, a: ServerAnsicht) => {
  const unbekannt = m.server_unbekannt();
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
    ...netzZeilen(a),
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
      name: m.server_zertifikat(),
      wert:
        a.zertifikatBis === null
          ? m.server_keine()
          : m.server_gueltig_bis({ datum: datum(a.zertifikatBis) }),
    },
    {
      name: m.server_fakten_am(),
      wert: a.faktenAm === null ? m.server_keine_fakten() : zeitpunkt(a.faktenAm, b.jetzt),
    },
  ];
};

const System = (props: Hier) => (
  <Karte>
    <KartenKopf titel={m.server_system()} text={m.server_system_text()} />
    <KartenInhalt class="grid gap-4">
      <Angaben zeilen={systemZeilen(props.b, props.a)} />
      <Show when={props.a.ramGb}>
        {(gb) => (
          <p class="text-xs text-muted-foreground">
            {m.server_ram_vergeben({
              vergeben: Math.round(ramDerMb(props.b, props.apps) / 1024),
              gesamt: gb(),
            })}
          </p>
        )}
      </Show>
    </KartenInhalt>
  </Karte>
);

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

export type PruefZeile = PruefText & { ok: boolean | null };

/**
 * The checks of the server: those of Z-702 from the Zentrale (disk, certificates, backups, open
 * ports, clock), those of the operating system from the demo data. A silent agent's last values
 * are no check: no OK and no warning (`still`); an unknown check neither
 */
export const pruefZeilen = (a: ServerAnsicht, jetzt: number, still: boolean): PruefZeile[] => [
  ...(a.pruefungen ?? []).map((p) => ({
    ...serverPruefungText(p, jetzt),
    ok: still || p.ergebnis === "unbekannt" ? null : !auffaellig(p),
  })),
  ...(a.demo ? pruefungen(a.demo) : []).map((p) => ({
    ...pruefText(p),
    ok: still ? null : p.ok,
  })),
];

/** A silent agent's last values are no check, as on an app's page */
export const agentStill = (a: ServerAnsicht) => a.agent.zustand !== "verbunden";

const Pruefungen = (props: { b: Bestand; a: ServerAnsicht }) => (
  <Karte>
    <KartenKopf
      titel={m.server_pruefungen()}
      text={agentStill(props.a) ? m.inst_units_still() : m.server_pruefungen_text()}
    />
    <KartenInhalt class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <For each={pruefZeilen(props.a, props.b.jetzt, agentStill(props.a))}>
        {(p) => <Pruefzeile icon={p.icon} name={p.name} detail={p.detail} ok={p.ok} />}
      </For>
    </KartenInhalt>
  </Karte>
);

export const TechnikReiter = (props: Hier) => (
  <div class="grid gap-4">
    <div class="grid items-start gap-4 lg:grid-cols-2">
      <System b={props.b} a={props.a} apps={props.apps} />
      <Wartung b={props.b} a={props.a} apps={props.apps} />
    </div>
    <Show when={props.a.pruefungen || props.a.demo}>
      <Pruefungen b={props.b} a={props.a} />
    </Show>
    <Show when={props.a.demo}>{(d) => <Neustart sv={d()} />}</Show>
  </div>
);
