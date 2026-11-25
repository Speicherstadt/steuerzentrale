import type { JSX } from "@solidjs/web";
import { getLocale, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, Loading, Show } from "solid-js";
import { aussenQuelle } from "../daten/aussen.ts";
import type { Einzelansicht } from "../daten/installationen-laden.ts";
import {
  ausfaelle,
  BEREICH_MS,
  type Bereich,
  backupGroessen,
  gesamtAnteil,
  type MonatsAnteil,
  monateDerTage,
  skalaMax,
  tagTon,
} from "../daten/messwerte.ts";
import { bestand } from "../daten/quelle.ts";
import { prozent, speicher, zahl } from "../format/zahl.ts";
import { datum } from "../format/zeit.ts";
import { Linie, Tagesbalken } from "../teile/diagramme.tsx";
import { Karte } from "../teile/karte.tsx";
import { Schalter } from "../teile/schalter.tsx";
import { Fehler, fehlerText } from "./anmeldung-teile.tsx";
import { backupsLaden } from "./installation-backups.tsx";
import { LAST_TAGE, LastKarte, stundenAus } from "./last-karten.tsx";

/*
 * The tab "Messwerte" of an app (docs/plan.md, "Navigation (Oberfläche 2026-11)"): only what the
 * Zentrale measures, nothing made up. The availability of the last 90 days from the checks from
 * outside (Z-704), a bar per day; the size of the nightly backups (Z-601) over 24 hours, 7 or 30
 * days; CPU and memory of the app's Linux user from the agent's facts (Z-1106, seiten/last-karten.tsx).
 * Response time follows once the agent reports it.
 */

const TAGE = 90;

/** A share as the page writes it: whole at 100 %, else two places, never rounded up to 100 */
const anteilText = (anteil: number | null): string => {
  if (anteil === null) return m.aussen_nicht_gemessen();
  const p = anteil * 100;
  return p >= 100 ? prozent(100) : prozent(Math.floor(p * 100) / 100, 2);
};

const monatsName = (v: Pick<MonatsAnteil, "jahr" | "monat">) =>
  new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(Date.UTC(v.jahr, v.monat - 1, 15));

export const Messkarte = (props: {
  titel: string;
  wert: string;
  notiz: JSX.Element;
  testid: string;
  children: JSX.Element;
}) => (
  <Karte class="grid gap-3 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3" data-testid={props.testid}>
      <div class="grid gap-0.5">
        <h2 class="text-muted-foreground">{props.titel}</h2>
        <p class="text-2xl font-semibold tabular-nums">{props.wert}</p>
      </div>
      <div class="grid justify-items-end gap-0.5 text-right text-xs text-muted-foreground">
        {props.notiz}
      </div>
    </div>
    {props.children}
  </Karte>
);

const Verfuegbarkeit = (props: { a: Einzelansicht }) => {
  const antwort = createMemo(() => aussenQuelle().tage(props.a.id, TAGE));
  const tage = () => {
    const r = antwort();
    return r.ok ? r.daten : [];
  };
  const aus = () => ausfaelle(tage());
  const fehler = () => {
    const r = antwort();
    return r.ok ? "" : fehlerText(r);
  };
  return (
    <Messkarte
      titel={m.mess_verfuegbarkeit({ tage: TAGE })}
      wert={anteilText(gesamtAnteil(tage()))}
      testid="verfuegbarkeit-90"
      notiz={
        <>
          <span>{m.mess_jede_minute()}</span>
          <span>
            {aus().tage === 0
              ? m.mess_kein_ausfall()
              : m.mess_ausfaelle({ tage: aus().tage, minuten: zahl(aus().minuten) })}
          </span>
        </>
      }
    >
      <Fehler text={fehler()} />
      <Tagesbalken
        tage={tage().map((t) => ({
          name: `${datum(t.von)}: ${anteilText(t.anteil)}`,
          ton: tagTon(t),
        }))}
      />
      <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{m.mess_vor_tagen({ tage: TAGE })}</span>
        <span>
          {monateDerTage(tage())
            .filter((v) => v.anteil !== null)
            .map((v) => `${monatsName(v)} ${anteilText(v.anteil)}`)
            .join(" · ")}
        </span>
        <span>{m.mess_heute()}</span>
      </div>
    </Messkarte>
  );
};

export const BEREICHE: { wert: Bereich; name: () => string; vor: () => string }[] = [
  { wert: "24h", name: () => m.mess_24h(), vor: () => m.mess_vor_24h() },
  { wert: "7t", name: () => m.mess_7t(), vor: () => m.mess_vor_tagen({ tage: 7 }) },
  { wert: "30t", name: () => m.mess_30t(), vor: () => m.mess_vor_tagen({ tage: 30 }) },
];

const mb = (bytes: number) => bytes / 1024 ** 2;

const Daten = (props: { a: Einzelansicht }) => {
  const [bereich, setBereich] = createSignal<Bereich>("7t");
  const antwort = backupsLaden(() => props.a);
  const jetzt = () => bestand().jetzt;
  const punkte = () => {
    const r = antwort();
    return r.ok ? backupGroessen(r.daten.laeufe, bereich(), jetzt()) : [];
  };
  const letzter = () => punkte().at(-1);
  // the scale from 0 to a round number of MB, or of GB once the data passes a GB
  const skala = () => {
    const groesste = mb(Math.max(1, ...punkte().map((p) => p.wert)));
    if (groesste < 1024) {
      const oben = skalaMax(groesste);
      return { bytes: oben * 1024 ** 2, text: m.einheit_mb({ wert: zahl(oben) }) };
    }
    const oben = skalaMax(groesste / 1024);
    return { bytes: oben * 1024 ** 3, text: m.einheit_gb({ wert: zahl(oben, 1) }) };
  };
  const von = () => jetzt() - BEREICH_MS[bereich()];
  // the part of the range before the first run with a size: said, not left empty
  const leer = () => {
    const erster = punkte()[0];
    return erster ? (erster.zeitpunkt - von()) / BEREICH_MS[bereich()] : 0;
  };
  const aenderung = () => {
    const p = punkte();
    const erster = p[0];
    const neu = p.at(-1);
    return erster && neu && p.length > 1 ? mb(neu.wert - erster.wert) : null;
  };
  const vor = () => BEREICHE.find((b) => b.wert === bereich())?.vor() ?? "";
  return (
    <Messkarte
      titel={m.mess_daten()}
      wert={letzter() ? speicher(mb(letzter()?.wert ?? 0)) : "–"}
      testid="daten"
      notiz={
        <>
          <Schalter
            name={m.mess_zeitraum()}
            aktuell={bereich()}
            onWahl={setBereich}
            wahl={BEREICHE.map((b) => ({ wert: b.wert, name: b.name() }))}
          />
          <span>
            {aenderung() === null
              ? m.mess_daten_quelle()
              : Math.abs(aenderung() ?? 0) < 0.5
                ? m.mess_daten_gleich()
                : m.mess_daten_aenderung({
                    aenderung: `${(aenderung() ?? 0) >= 0 ? "+" : "−"}${speicher(Math.abs(aenderung() ?? 0))}`,
                  })}
          </span>
        </>
      }
    >
      <Show
        when={punkte().length > 0}
        fallback={<p class="py-10 text-center text-muted-foreground">{m.mess_daten_keine()}</p>}
      >
        <div class="grid gap-1">
          <span class="justify-self-end text-xs text-muted-foreground" data-testid="skala">
            {skala().text}
          </span>
          <div class="relative">
            <Linie punkte={punkte()} von={von()} bis={jetzt()} max={skala().bytes} />
            <Show when={leer() > 0.1}>
              <span
                class="absolute inset-y-0 left-0 flex items-center justify-center rounded-sm bg-muted/60 px-2 text-center text-xs text-muted-foreground"
                style={{ width: `${leer() * 100}%` }}
                data-testid="ohne-daten"
              >
                {m.mess_noch_keine()}
              </span>
            </Show>
          </div>
          <span class="text-xs text-muted-foreground">{m.einheit_mb({ wert: "0" })}</span>
        </div>
      </Show>
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>{vor()}</span>
        <span>{m.mess_jetzt()}</span>
      </div>
    </Messkarte>
  );
};

/** CPU and memory of the app's Linux user (Z-1106) */
const AppLast = (props: { id: string }) => {
  const s = stundenAus(() => aussenQuelle().last(props.id, LAST_TAGE));
  return (
    <>
      <Fehler text={s.fehler()} />
      <LastKarte
        titel={m.server_spalte_cpu()}
        testid="mess-cpu"
        einheit="prozent"
        stunden={s.stunden()}
        wert={(x) => x.cpuProzent}
        quelle={m.last_quelle_nutzer_cpu()}
      />
      <LastKarte
        titel={m.server_spalte_ram()}
        testid="mess-ram"
        einheit="mb"
        stunden={s.stunden()}
        wert={(x) => x.ramMb}
        quelle={m.last_quelle_nutzer_ram()}
      />
    </>
  );
};

export const AppMesswerte = (props: { a: Einzelansicht }) => (
  <div class="grid gap-4">
    <Loading fallback={<p class="text-muted-foreground">{m.aussen_laden()}</p>}>
      <Verfuegbarkeit a={props.a} />
    </Loading>
    <div class="grid gap-4 lg:grid-cols-2">
      <Loading fallback={<p class="text-muted-foreground">{m.bak_laden()}</p>}>
        <Daten a={props.a} />
      </Loading>
      <Loading fallback={<p class="text-muted-foreground">{m.last_laden()}</p>}>
        <AppLast id={props.a.id} />
      </Loading>
    </div>
  </div>
);
