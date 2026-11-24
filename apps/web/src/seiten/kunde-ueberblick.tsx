import type { KundenLeistung } from "@steuerzentrale/planung";
import { Icon, m } from "@steuerzentrale/ui";
import { For, Show } from "solid-js";
import type { AppZeile } from "../daten/apps-liste.ts";
import type { Kunde } from "../daten/typen.ts";
import { gbAusBytes, minuten, prozent, zahl } from "../format/zahl.ts";
import { datum } from "../format/zeit.ts";
import { slaName, slaText, welleName } from "../rahmen/texte.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { ZustandIcon, zustandText } from "./apps-tabelle.tsx";

/*
 * The tab "Überblick" of a customer (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * apps with address, version and state (Z-402, Z-403), this month's figures as the page
 * "Leistungen" has them (Z-804), its contract and its contact (Z-801).
 */

/** A share as the pages write it: whole at 100 %, else two places cut off, never rounded up */
export const anteilText = (anteil: number | null): string => {
  if (anteil === null) return m.aussen_nicht_gemessen();
  const p = anteil * 100;
  return p >= 100 ? prozent(100) : prozent(Math.floor(p * 100) / 100, 2);
};

const versionText = (z: AppZeile) =>
  z.ziel ? `${z.a.version} → ${z.ziel}` : m.app_version({ version: z.a.version });

const AppsKarte = (props: { zeilen: AppZeile[] }) => (
  <Karte>
    <KartenKopf titel={m.nav_apps()} text={m.kunde_apps_text()} />
    <KartenInhalt>
      <ul class="divide-y" data-testid="kunde-apps">
        <For
          each={props.zeilen}
          fallback={<li class="py-3 text-muted-foreground">{m.kunde_keine_app()}</li>}
        >
          {(z) => (
            <li class="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-md border">
                <Icon icon={appIcon(z.a.appIcon)} />
              </span>
              <div class="min-w-0 flex-1">
                <ZuInstallation id={z.a.id} class="font-medium">
                  {z.a.appName}
                </ZuInstallation>
                <p class="break-words text-muted-foreground">
                  {[z.a.host, versionText(z), z.a.serverName].join(" · ")}
                </p>
              </div>
              <span class="ml-11 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground sm:ml-0">
                <ZustandIcon z={z.zustand} />
                {z.stufe === "gut" ? m.app_in_ordnung() : zustandText(z.zustand)}
              </span>
            </li>
          )}
        </For>
      </ul>
    </KartenInhalt>
  </Karte>
);

const Zahl = (props: { wert: string; name: string }) => (
  <div class="grid gap-0.5">
    <p class="text-2xl font-semibold tabular-nums">{props.wert}</p>
    <p class="text-muted-foreground">{props.name}</p>
  </div>
);

/** This month as the page "Leistungen" counts it; without its figures nothing is shown */
const DieserMonat = (props: { apps: number; l: KundenLeistung | undefined }) => (
  <Show when={props.l}>
    {(l) => (
      <Karte>
        <KartenKopf titel={m.kunde_dieser_monat()} />
        <KartenInhalt class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Zahl wert={zahl(props.apps)} name={m.nav_apps()} />
          <Zahl
            wert={l().speicherBytes === null ? "–" : gbAusBytes(l().speicherBytes ?? 0)}
            name={m.inst_spalte_daten()}
          />
          <Zahl wert={anteilText(l().verfuegbarkeit.anteil)} name={m.inst_verfuegbarkeit()} />
          <Zahl wert={minuten(l().supportMinuten)} name={m.kunde_reiter_support()} />
        </KartenInhalt>
      </Karte>
    )}
  </Show>
);

const VertragsKarte = (props: { k: Kunde }) => (
  <Karte>
    <KartenKopf titel={m.kunde_vertrag()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunde_stufe(), wert: slaName(props.k.vertrag.sla) },
          { name: m.kunde_feld_beginn(), wert: datum(props.k.vertrag.beginn) },
          {
            name: m.kunde_feld_ende(),
            wert:
              props.k.vertrag.ende === null ? m.kunde_ungekuendigt() : datum(props.k.vertrag.ende),
          },
          { name: m.kunde_updates(), wert: slaText(props.k.vertrag.sla) },
          { name: m.inst_welle(), wert: welleName(props.k.intern ? "intern" : "alle") },
          { name: m.kunde_feld_kuerzel(), wert: props.k.kuerzel },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const KontaktKarte = (props: { k: Kunde }) => (
  <Karte>
    <KartenKopf titel={m.kunde_kontakt_titel()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunde_feld_ansprechpartner(), wert: props.k.kontakt.name },
          { name: m.anm_email(), wert: props.k.kontakt.email },
          { name: m.kunde_feld_telefon(), wert: props.k.kontakt.telefon ?? "–" },
          { name: m.kunde_feld_notiz(), wert: props.k.notiz ?? "–" },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

export const KundeUeberblick = (props: {
  k: Kunde;
  zeilen: AppZeile[];
  monat: KundenLeistung | undefined;
}) => (
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <div class="grid gap-4">
      <AppsKarte zeilen={props.zeilen} />
      <DieserMonat apps={props.zeilen.length} l={props.monat} />
    </div>
    <div class="grid gap-4">
      <VertragsKarte k={props.k} />
      <KontaktKarte k={props.k} />
    </div>
  </div>
);
