import type { KundenLeistung } from "@steuerzentrale/planung";
import { getLocale, m } from "@steuerzentrale/ui";
import { createMemo, For, Loading } from "solid-js";
import type { AppZeile } from "../daten/apps-liste.ts";
import { aussenQuelle, ZIEL_PROZENT } from "../daten/aussen.ts";
import { verfuegbarkeitsTabelle, type Zelle } from "../daten/kunde-ansicht.ts";
import { bestand } from "../daten/quelle.ts";
import type { Kunde } from "../daten/typen.ts";
import { gbAusBytes, minuten, prozent } from "../format/zahl.ts";
import { slaName, slaText } from "../rahmen/texte.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { anteilText } from "./kunde-ueberblick.tsx";

/*
 * The tab "Leistungen" of a customer (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): the
 * availability of each of its apps in each of the last six months and of all together, from the
 * months GET /api/v1/installationen/:id/aussen answers (Z-704; daten/kunde-ansicht.ts), a month
 * under the SLA's mark in the warn colour; and what its contract includes, with this month's
 * figures of the page "Leistungen" (Z-804).
 */

const MONATE = 6;

const monatKurz = (jahr: number, monat: number) =>
  new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(jahr, monat - 1, 15));

const ZellenText = (props: { z: Zelle }) => (
  <td
    class={[
      "text-right font-mono text-xs whitespace-nowrap tabular-nums",
      props.z.anteil === null
        ? "text-muted-foreground"
        : props.z.unterZiel
          ? "font-medium text-warn"
          : "",
    ]}
  >
    {props.z.anteil === null ? "–" : anteilText(props.z.anteil)}
  </td>
);

const Verfuegbarkeit = (props: { zeilen: AppZeile[] }) => {
  const antworten = createMemo(() =>
    Promise.all(props.zeilen.map((z) => aussenQuelle().derInstallation(z.a.id))),
  );
  const tabelle = () =>
    verfuegbarkeitsTabelle(
      props.zeilen.map((z, n) => {
        const r = antworten()[n];
        return { id: z.a.id, monate: r?.ok ? r.daten.verfuegbarkeit : [] };
      }),
      MONATE,
      bestand().jetzt,
    );
  const name = (id: string) => props.zeilen.find((z) => z.a.id === id)?.a.appName ?? id;
  return (
    <Tabelle
      name={m.kunde_verfuegbarkeit_tabelle()}
      rahmen={false}
      minBreite={640}
      leer={m.kunde_keine_app()}
      anzahl={props.zeilen.length}
      spalten={[
        { name: m.inst_spalte_app() },
        ...tabelle().monate.map((v) => ({ name: monatKurz(v.jahr, v.monat), class: "text-right" })),
      ]}
    >
      <For each={tabelle().zeilen}>
        {(z) => (
          <Reihe>
            <td class="font-medium">{name(z.id)}</td>
            <For each={z.zellen}>{(zelle) => <ZellenText z={zelle} />}</For>
          </Reihe>
        )}
      </For>
      <Reihe class="bg-muted/40">
        <td class="font-medium">{m.kunde_alle_apps()}</td>
        <For each={tabelle().gesamt}>{(zelle) => <ZellenText z={zelle} />}</For>
      </Reihe>
    </Tabelle>
  );
};

const VertragEnthaelt = (props: { k: Kunde; monat: KundenLeistung | undefined }) => (
  <Karte>
    <KartenKopf titel={m.kunde_enthaelt()} text={m.kunde_enthaelt_text()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunde_stufe(), wert: slaName(props.k.vertrag.sla) },
          { name: m.kunde_updates(), wert: slaText(props.k.vertrag.sla) },
          {
            name: m.inst_verfuegbarkeit(),
            wert: m.kunde_verfuegbarkeit_ziel({ ziel: prozent(ZIEL_PROZENT, 1) }),
          },
          {
            name: m.kunde_support_monat(),
            wert: props.monat ? minuten(props.monat.supportMinuten) : "–",
          },
          {
            name: m.kunde_daten_monat(),
            wert: props.monat?.speicherBytes == null ? "–" : gbAusBytes(props.monat.speicherBytes),
          },
          { name: m.kunde_nach_ende(), wert: m.kunde_nach_ende_text() },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

export const KundeLeistungen = (props: {
  k: Kunde;
  zeilen: AppZeile[];
  monat: KundenLeistung | undefined;
}) => (
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <Karte>
      <KartenKopf
        titel={m.kunde_verfuegbarkeit_titel()}
        text={m.kunde_verfuegbarkeit_text({ ziel: prozent(ZIEL_PROZENT, 1) })}
      />
      <div class="border-t">
        <Loading fallback={<p class="p-5 text-muted-foreground">{m.aussen_laden()}</p>}>
          <Verfuegbarkeit zeilen={props.zeilen} />
        </Loading>
      </div>
    </Karte>
    <VertragEnthaelt k={props.k} monat={props.monat} />
  </div>
);
