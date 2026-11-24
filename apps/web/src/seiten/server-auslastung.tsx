import { m } from "@steuerzentrale/ui";
import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import { type PlattenReihe, plattenReihen } from "../daten/auslastung.ts";
import { BEREICH_MS, type Bereich } from "../daten/messwerte.ts";
import { bestand } from "../daten/quelle.ts";
import { serverQuelle } from "../daten/server.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import { prozent, zahl } from "../format/zahl.ts";
import { Linie } from "../teile/diagramme.tsx";
import { Karte } from "../teile/karte.tsx";
import { Schalter } from "../teile/schalter.tsx";
import { Fehler, fehlerText } from "./anmeldung-teile.tsx";
import { BEREICHE, Messkarte } from "./app-messwerte.tsx";

/*
 * The tab "Auslastung" of a server (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): how
 * full each disk was over 24 hours, 7 or 30 days, from the history of the agent's facts
 * (GET /api/v1/server/:id/platten, kept 30 days), on a scale from 0 to 100 %. CPU and memory
 * follow once the agent reports them; until then a note says so instead of a made-up curve.
 */

const TAGE = 30;

/** "+1,2 Prozentpunkte" over the range, or that it stayed the same */
const aenderungText = (r: PlattenReihe): string => {
  if (r.aenderung === null) return m.last_platte_quelle();
  if (Math.abs(r.aenderung) < 0.1) return m.last_platte_gleich();
  const zeichen = r.aenderung >= 0 ? "+" : "−";
  return m.last_platte_aenderung({ punkte: `${zeichen}${zahl(Math.abs(r.aenderung), 1)}` });
};

const PlattenKarte = (props: {
  r: PlattenReihe;
  bereich: Bereich;
  setBereich: (b: Bereich) => void;
}) => {
  const jetzt = () => bestand().jetzt;
  const vor = () => BEREICHE.find((b) => b.wert === props.bereich)?.vor() ?? "";
  return (
    <Messkarte
      titel={
        props.r.mount === "/"
          ? m.server_spalte_platte()
          : m.server_platte_mount({ mount: props.r.mount })
      }
      wert={props.r.aktuell === null ? "–" : prozent(props.r.aktuell, props.r.aktuell % 1 ? 1 : 0)}
      testid={`platte-${props.r.mount}`}
      notiz={
        <>
          <Schalter
            name={m.mess_zeitraum()}
            aktuell={props.bereich}
            onWahl={props.setBereich}
            wahl={BEREICHE.map((b) => ({ wert: b.wert, name: b.name() }))}
          />
          <span>{aenderungText(props.r)}</span>
        </>
      }
    >
      <div class="grid gap-1">
        <span class="justify-self-end text-xs text-muted-foreground">{prozent(100)}</span>
        <Linie
          punkte={props.r.punkte}
          von={jetzt() - BEREICH_MS[props.bereich]}
          bis={jetzt()}
          max={100}
        />
        <span class="text-xs text-muted-foreground">{prozent(0)}</span>
      </div>
      <div class="flex justify-between text-xs text-muted-foreground">
        <span>{vor()}</span>
        <span>{m.mess_jetzt()}</span>
      </div>
    </Messkarte>
  );
};

const Platten = (props: { a: ServerAnsicht }) => {
  const [bereich, setBereich] = createSignal<Bereich>("7t");
  const antwort = createMemo(() => serverQuelle().platten(props.a.id, TAGE));
  const reihen = () => {
    const r = antwort();
    return r.ok ? plattenReihen(r.daten, bereich(), bestand().jetzt) : [];
  };
  const fehler = () => {
    const r = antwort();
    return r.ok ? "" : fehlerText(r);
  };
  return (
    <>
      <Fehler text={fehler()} />
      <For
        each={reihen()}
        fallback={
          <Show when={!fehler()}>
            <Karte class="p-5">
              <p class="py-10 text-center text-muted-foreground" data-testid="platte-keine">
                {m.last_platte_keine()}
              </p>
            </Karte>
          </Show>
        }
      >
        {(r) => <PlattenKarte r={r} bereich={bereich()} setBereich={setBereich} />}
      </For>
    </>
  );
};

export const ServerAuslastung = (props: { a: ServerAnsicht }) => (
  <div class="grid gap-4 lg:grid-cols-2">
    <Loading fallback={<p class="text-muted-foreground">{m.last_laden()}</p>}>
      <Platten a={props.a} />
    </Loading>
    <Karte class="flex items-center justify-center border-dashed p-5">
      <p class="max-w-sm text-center text-muted-foreground" data-testid="last-hinweis">
        {m.last_spaeter()}
      </p>
    </Karte>
  </div>
);
