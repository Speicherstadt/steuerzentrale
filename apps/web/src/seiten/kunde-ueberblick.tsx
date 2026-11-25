import { Icon, m } from "@steuerzentrale/ui";
import { For } from "solid-js";
import type { AppZeile } from "../daten/apps-liste.ts";
import type { Kunde } from "../daten/typen.ts";
import { datum } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { ZustandIcon, zustandText } from "./apps-tabelle.tsx";

/*
 * The tab "Überblick" of a customer (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * apps with address, version and state (Z-402, Z-403), its contract and its contact (Z-801).
 */

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

const VertragsKarte = (props: { k: Kunde }) => (
  <Karte>
    <KartenKopf titel={m.kunde_vertrag()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunde_feld_beginn(), wert: datum(props.k.vertrag.beginn) },
          {
            name: m.kunde_feld_ende(),
            wert:
              props.k.vertrag.ende === null ? m.kunde_ungekuendigt() : datum(props.k.vertrag.ende),
          },
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

export const KundeUeberblick = (props: { k: Kunde; zeilen: AppZeile[] }) => (
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <div class="grid gap-4">
      <AppsKarte zeilen={props.zeilen} />
    </div>
    <div class="grid gap-4">
      <VertragsKarte k={props.k} />
      <KontaktKarte k={props.k} />
    </div>
  </div>
);
