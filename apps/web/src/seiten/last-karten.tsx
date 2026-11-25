import { m } from "@steuerzentrale/ui";
import { createMemo, createSignal, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { lastReihe } from "../daten/auslastung.ts";
import { BEREICH_MS, type Bereich, skalaMax } from "../daten/messwerte.ts";
import { bestand } from "../daten/quelle.ts";
import { prozent, speicher, zahl } from "../format/zahl.ts";
import { Linie } from "../teile/diagramme.tsx";
import { Schalter } from "../teile/schalter.tsx";
import { fehlerText } from "./anmeldung-teile.tsx";
import { BEREICHE, Messkarte } from "./app-messwerte.tsx";

/*
 * The curves of CPU, load and memory (BAULISTE.md Z-1106) on a server's tab "Auslastung" and an
 * app's tab "Messwerte": over 24 hours, 7 or 30 days, each point the highest reading of its step,
 * from the history of the agent's facts, which the Zentrale keeps 30 days. Nothing is drawn
 * without a reading: a note says the agent has not reported any yet.
 */

export const LAST_TAGE = 30;

export type Einheit = "prozent" | "last" | "mb";

const text = (wert: number, einheit: Einheit) =>
  einheit === "prozent"
    ? prozent(wert, wert % 1 ? 1 : 0)
    : einheit === "mb"
      ? speicher(wert)
      : zahl(wert, 2);

/** The top of the scale: 100 % for a share, else a round number above the highest point */
const oben = (hoechstes: number, einheit: Einheit) =>
  einheit === "prozent" ? 100 : skalaMax(Math.max(einheit === "last" ? 1 : 1, hoechstes));

export const LastKarte = <S extends { stunde: number }>(props: {
  titel: string;
  testid: string;
  einheit: Einheit;
  stunden: S[];
  wert: (s: S) => number | null;
  quelle: string;
}) => {
  const [bereich, setBereich] = createSignal<Bereich>("24h");
  const jetzt = () => bestand().jetzt;
  const reihe = () => lastReihe(props.stunden, props.wert, bereich(), jetzt());
  const max = () => oben(Math.max(0, ...reihe().punkte.map((p) => p.wert)), props.einheit);
  const vor = () => BEREICHE.find((b) => b.wert === bereich())?.vor() ?? "";
  return (
    <Messkarte
      titel={props.titel}
      wert={reihe().aktuell === null ? "–" : text(reihe().aktuell ?? 0, props.einheit)}
      testid={props.testid}
      notiz={
        <>
          <Schalter
            name={m.mess_zeitraum()}
            aktuell={bereich()}
            onWahl={setBereich}
            wahl={BEREICHE.map((b) => ({ wert: b.wert, name: b.name() }))}
          />
          <span>{props.quelle}</span>
        </>
      }
    >
      <Show
        when={reihe().punkte.length > 0}
        fallback={<p class="py-10 text-center text-muted-foreground">{m.last_keine()}</p>}
      >
        <div class="grid gap-1">
          <span class="justify-self-end text-xs text-muted-foreground">
            {text(max(), props.einheit)}
          </span>
          <Linie
            punkte={reihe().punkte}
            von={jetzt() - BEREICH_MS[bereich()]}
            bis={jetzt()}
            max={max()}
          />
          <span class="text-xs text-muted-foreground">{text(0, props.einheit)}</span>
        </div>
      </Show>
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>{vor()}</span>
        <span>{m.mess_jetzt()}</span>
      </div>
    </Messkarte>
  );
};

/** The answer of a source of hours, its hours or none, and its error in words */
export const stundenAus = <S,>(laden: () => Promise<Antwort<S[]>>) => {
  const antwort = createMemo(() => laden());
  return {
    stunden: () => {
      const a = antwort();
      return a.ok ? a.daten : [];
    },
    fehler: () => {
      const a = antwort();
      return a.ok ? "" : fehlerText(a);
    },
  };
};
