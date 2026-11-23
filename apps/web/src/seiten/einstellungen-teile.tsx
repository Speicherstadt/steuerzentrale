import { getLocale, type Locale, locales, m, setLocale } from "@steuerzentrale/ui";
import { createMemo, createUniqueId, For, Loading } from "solid-js";
import { mitgliederLesen } from "../daten/mitglieder.ts";
import { mitDemo } from "../daten/quelle.ts";
import type { Bestand } from "../daten/typen.ts";
import { datum } from "../format/zeit.ts";
import { rolleName } from "../rahmen/texte.ts";
import { aktuellesThema, THEMEN, type Thema, waehleThema } from "../rahmen/theme.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";

/**
 * The tabs of the settings, read-only until their items let them be changed (each change with a
 * reason, DESIGN.md); the operator's values per app are in einstellungen-apps.tsx (Z-404), the
 * backup target in einstellungen-backup.tsx (Z-601), DNS in einstellungen-dns.tsx (Z-407),
 * notifications in einstellungen-melden.tsx (Z-703); "Darstellung" is the viewer's own and takes
 * effect at once. The accounts are the operator's members from the Zentrale (Z-406).
 */

const mono = (text: string) => <span class="font-mono text-xs">{text}</span>;

/** The operator's members with their roles, from the Zentrale (GET /api/v1/mitglieder) */
export const Konten = () => {
  const antwort = createMemo(() => mitgliederLesen());
  const liste = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  return (
    <Karte class="overflow-hidden">
      <KartenKopf titel={m.einst_konten()} text={m.einst_konten_text()} />
      <div class="border-t">
        <Loading fallback={<p class="p-5 text-muted-foreground">{m.einst_konten_laden()}</p>}>
          <Tabelle
            name={m.einst_konten()}
            rahmen={false}
            minBreite={560}
            leer={m.einst_konten_keine()}
            anzahl={liste().length}
            spalten={[
              { name: m.einst_name() },
              { name: m.anm_email() },
              { name: m.einst_rolle() },
              { name: m.einst_mitglied_seit() },
            ]}
          >
            <For each={liste()}>
              {(k) => (
                <Reihe>
                  <td class="font-medium">{k.name}</td>
                  <td class="font-mono text-xs">{k.email}</td>
                  <td class="text-xs">{rolleName(k.rolle)}</td>
                  <td class="text-xs text-muted-foreground">{datum(k.angelegtAm)}</td>
                </Reihe>
              )}
            </For>
          </Tabelle>
        </Loading>
      </div>
      <p class="p-5 pt-4 text-xs text-muted-foreground">{m.einst_rollen()}</p>
    </Karte>
  );
};

export const Zentrale = (props: { b: Bestand }) => (
  <Karte>
    <KartenKopf titel={m.app_name()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.einst_oberflaeche(), wert: m.einst_oberflaeche_wert() },
          ...(mitDemo()
            ? [{ name: m.einst_agenten(), wert: mono(`wss://agent.${props.b.betreiber.domain}`) }]
            : []),
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
