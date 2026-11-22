import { getLocale, type Locale, locales, m, setLocale } from "@steuerzentrale/ui";
import { createUniqueId, For } from "solid-js";
import type { Bestand } from "../daten/typen.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { rolleName } from "../rahmen/texte.ts";
import { aktuellesThema, THEMEN, type Thema, waehleThema } from "../rahmen/theme.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";

/**
 * The tabs of the settings, read-only until their items let them be changed (each change with a
 * reason, DESIGN.md); the operator's values per app are in einstellungen-apps.tsx (Z-404);
 * "Darstellung" is the viewer's own and takes effect at once
 */

const mono = (text: string) => <span class="font-mono text-xs">{text}</span>;

export const Backup = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.einst_backup()} text={m.einst_backup_text()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.einst_s3(), wert: mono(props.b.betreiber.s3) },
          { name: m.einst_zugang(), wert: m.inst_wert_gesetzt() },
          { name: m.einst_zeitplan(), wert: m.einst_zeitplan_wert() },
          { name: m.einst_aufbewahrung(), wert: m.einst_aufbewahrung_wert() },
          { name: m.inst_pruef(), wert: m.einst_pruef_wert() },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

export const Dns = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.einst_dns()} text={m.einst_dns_text()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.einst_zone(), wert: mono(props.b.betreiber.domain) },
          { name: m.einst_schema(), wert: mono(`<app>.<kunde>.${props.b.betreiber.domain}`) },
          { name: m.einst_token(), wert: m.einst_token_wert() },
          { name: m.einst_zertifikate(), wert: m.einst_zertifikate_wert() },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

export const Benachrichtigungen = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.einst_melden()} text={m.einst_melden_text()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.einst_smtp(), wert: mono(props.b.betreiber.benachrichtigung.smtp) },
          { name: m.einst_an(), wert: mono(props.b.betreiber.benachrichtigung.an) },
          { name: m.einst_webhook(), wert: mono(props.b.betreiber.benachrichtigung.webhook) },
          {
            name: m.einst_ruhezeit(),
            wert: m.einst_ruhezeit_wert({ zeit: props.b.betreiber.benachrichtigung.ruhezeit }),
          },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

export const Konten = (props: { b: Bestand }) => (
  <Karte class="overflow-hidden">
    <KartenKopf titel={m.einst_konten()} text={m.einst_konten_text()} />
    <div class="border-t">
      <Tabelle
        name={m.einst_konten()}
        rahmen={false}
        minBreite={560}
        leer=""
        anzahl={props.b.konten.length}
        spalten={[
          { name: m.einst_name() },
          { name: m.einst_rolle() },
          { name: m.einst_faktor() },
          { name: m.einst_zuletzt() },
        ]}
      >
        <For each={props.b.konten}>
          {(k) => (
            <Reihe>
              <td class="font-medium">{k.name}</td>
              <td class="text-xs">{rolleName(k.rolle)}</td>
              <td class="text-xs">
                {k.faktor === "passkey" ? m.faktor_passkey() : m.faktor_totp()}
              </td>
              <td class="text-xs text-muted-foreground">{zeitpunkt(k.zuletzt, props.b.jetzt)}</td>
            </Reihe>
          )}
        </For>
      </Tabelle>
    </div>
    <p class="p-5 pt-4 text-xs text-muted-foreground">{m.einst_rollen()}</p>
  </Karte>
);

export const Zentrale = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.app_name()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.einst_oberflaeche(), wert: m.einst_oberflaeche_wert() },
          { name: m.einst_agenten(), wert: mono(`wss://agent.${props.b.betreiber.domain}`) },
          { name: m.einst_signatur(), wert: m.einst_signatur_wert() },
          { name: m.einst_aufbewahrung_daten(), wert: m.einst_aufbewahrung_daten_wert() },
          { name: m.einst_schluessel(), wert: m.inst_wert_gesetzt() },
          { name: m.einst_eigenes_backup(), wert: m.einst_eigenes_backup_wert() },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const THEMA_NAMEN: Record<Thema, () => string> = {
  system: () => m.thema_system(),
  hell: () => m.thema_hell(),
  dunkel: () => m.thema_dunkel(),
};

/** Each language under its own name ("Deutsch", "English"), from the browser's Intl */
const sprachName = (locale: Locale) =>
  new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;

const feld =
  "h-8 w-full rounded-lg border bg-background px-2.5 focus-visible:outline-2 focus-visible:outline-foreground";

export const Darstellung = () => {
  const themaId = createUniqueId();
  const spracheId = createUniqueId();
  return (
    <Karte>
      <KartenKopf titel={m.einst_darstellung()} text={m.einst_darstellung_text()} />
      <KartenInhalt class="grid max-w-sm gap-4">
        <div class="grid gap-1.5">
          <label for={themaId} class="text-xs font-medium">
            {m.thema_label()}
          </label>
          <select
            id={themaId}
            class={feld}
            value={aktuellesThema()}
            onChange={(event) => waehleThema(event.currentTarget.value as Thema)}
          >
            <For each={THEMEN}>{(t) => <option value={t}>{THEMA_NAMEN[t]()}</option>}</For>
          </select>
        </div>
        <div class="grid gap-1.5">
          <label for={spracheId} class="text-xs font-medium">
            {m.sprache_label()}
          </label>
          <select
            id={spracheId}
            class={feld}
            value={getLocale()}
            onChange={(event) => setLocale(event.currentTarget.value as Locale)}
          >
            <For each={locales}>
              {(locale) => (
                <option value={locale} lang={locale}>
                  {sprachName(locale)}
                </option>
              )}
            </For>
          </select>
        </div>
      </KartenInhalt>
    </Karte>
  );
};
