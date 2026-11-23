import { type Leistungen, leistungenDatei, letzteMonate, monatText } from "@steuerzentrale/planung";
import { buttonClass, Icon, m } from "@steuerzentrale/ui";
import { Download } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, createUniqueId, For, Loading, Show } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import { leistungenQuelle } from "../daten/leistungen.ts";
import { bestand } from "../daten/quelle.ts";
import { gbAusBytes, minuten, prozent } from "../format/zahl.ts";
import { monatName } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuKunde } from "../teile/verweise.tsx";
import { AppZeichen, Marke } from "../teile/zeichen.tsx";

/*
 * What each customer used in a month (BAULISTE.md Z-804; docs/plan.md, "Leistungen"): a month of
 * the last 13, its customers with installations, availability, data and support time, and the
 * month as CSV; invoices are the portal's business.
 */

const MONATE = 13;

const feldKlasse =
  "h-8 rounded-lg border border-border bg-background px-2.5 text-[13px] disabled:opacity-50";

const MonatsWahl = (props: { monat: string; monate: string[]; setzen: (m: string) => void }) => {
  const id = createUniqueId();
  return (
    <div class="flex items-center gap-2">
      <label for={id} class="text-xs font-medium">
        {m.leist_monate()}
      </label>
      <select
        id={id}
        class={feldKlasse}
        data-testid="leistungen-monat"
        onChange={(e) => props.setzen(e.currentTarget.value)}
      >
        <For each={props.monate}>
          {(monat) => (
            <option value={monat} selected={monat === props.monat}>
              {monatName(monat)}
            </option>
          )}
        </For>
      </select>
    </div>
  );
};

/** An app of the manifests with its mark; one the interface does not describe by its id */
const App = (props: { app: string }) => (
  <Show
    when={suche(bestand().apps, props.app)}
    fallback={<Marke class="font-mono">{props.app}</Marke>}
  >
    {(a) => <AppZeichen app={a()} />}
  </Show>
);

const Tabellenzeilen = (props: { l: Leistungen }) => (
  <Tabelle
    name={m.leist_tabelle({ monat: monatName(props.l.monat) })}
    minBreite={800}
    leer={m.kunden_keine()}
    anzahl={props.l.kunden.length}
    spalten={[
      { name: m.inst_spalte_kunde() },
      { name: m.nav_installationen() },
      { name: m.inst_verfuegbarkeit(), class: "text-right" },
      { name: m.inst_spalte_daten(), class: "text-right" },
      { name: m.nav_support(), class: "text-right" },
    ]}
  >
    <For each={props.l.kunden}>
      {(k) => (
        <Reihe>
          <td>
            <ZuKunde id={k.kundeId} class="font-medium">
              {k.name}
            </ZuKunde>
          </td>
          <td>
            <div class="flex flex-wrap gap-1">
              <For each={k.installationen}>{(i) => <App app={i.app} />}</For>
            </div>
          </td>
          <td class="text-right font-mono text-xs tabular-nums">
            {k.verfuegbarkeit.anteil === null
              ? m.aussen_nicht_gemessen()
              : prozent(k.verfuegbarkeit.anteil * 100, 2)}
          </td>
          <td class="text-right font-mono text-xs tabular-nums">
            {k.speicherBytes === null ? "–" : gbAusBytes(k.speicherBytes)}
          </td>
          <td class="text-right text-xs tabular-nums">
            {k.supportMinuten ? minuten(k.supportMinuten) : "–"}
          </td>
        </Reihe>
      )}
    </For>
  </Tabelle>
);

const LeistungenSeite = () => {
  const monate = letzteMonate(bestand().jetzt, MONATE).map(monatText);
  const [monat, setMonat] = createSignal(monate[0] ?? "");
  const antwort = createMemo(() => leistungenQuelle().imMonat(monat()));
  const gelesen = () => {
    const r = antwort();
    return r.ok ? r.daten : undefined;
  };
  const fehler = () => {
    const r = antwort();
    return r.ok ? "" : fehlerText(r);
  };
  return (
    <div class="grid gap-6">
      <Seitenkopf
        titel={m.nav_leistungen()}
        text={m.leist_text()}
        aktion={
          <>
            <MonatsWahl monat={monat()} monate={monate} setzen={setMonat} />
            <a
              href={leistungenQuelle().csvAdresse(monat())}
              download={leistungenDatei(monat())}
              class={buttonClass({ variant: "outline" })}
            >
              <Icon icon={Download} size={14} />
              {m.leist_csv()}
            </a>
          </>
        }
      />
      <Loading fallback={<p class="text-muted-foreground">{m.leist_laden()}</p>}>
        <Show when={gelesen()} fallback={<Fehler text={fehler()} />}>
          {(l) => <Tabellenzeilen l={l()} />}
        </Show>
      </Loading>
      <p class="text-xs text-muted-foreground">{m.leist_hinweis()}</p>
    </div>
  );
};

export const Route = createFileRoute("/leistungen")({ component: LeistungenSeite });
