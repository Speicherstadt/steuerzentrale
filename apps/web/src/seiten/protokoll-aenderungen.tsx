import { m } from "@steuerzentrale/ui";
import { For, Match, Switch } from "solid-js";
import { type Akteur, type AuditEintragDerZentrale, betriebQuelle } from "../daten/betrieb.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Seitenweise } from "../teile/seitenweise.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZielLink, ZuServer } from "../teile/verweise.tsx";

/**
 * Every write with actor, time, target and reason; append-only (BAULISTE.md Z-102), newest first,
 * page by page from the Zentrale (Z-406); only owner and technik read it, the Zentrale refuses
 * support anyway
 */

const Wer = (props: { akteur: Akteur }) => (
  <Switch fallback={m.audit_zentrale({ wer: props.akteur.id })}>
    <Match when={props.akteur.art === "person" && props.akteur}>{(p) => <>{p().name}</>}</Match>
    <Match when={props.akteur.art === "server" && props.akteur}>
      {(s) => <ZuServer id={s().id}>{s().name}</ZuServer>}
    </Match>
  </Switch>
);

const Eintraege = (props: { eintraege: AuditEintragDerZentrale[] }) => (
  <Tabelle
    name={m.audit_tabelle()}
    minBreite={880}
    leer={m.audit_leer()}
    anzahl={props.eintraege.length}
    spalten={[
      { name: m.audit_spalte_zeit() },
      { name: m.sup_spalte_wer() },
      { name: m.audit_spalte_aktion() },
      { name: m.auftraege_spalte_ziel() },
      { name: m.sup_spalte_grund() },
    ]}
  >
    <For each={props.eintraege}>
      {(e) => (
        <Reihe>
          <td class="text-xs whitespace-nowrap tabular-nums">
            {zeitpunkt(e.zeitpunkt, bestand().jetzt)}
          </td>
          <td class="text-xs">
            <Wer akteur={e.akteur} />
          </td>
          <td class="font-mono text-xs font-medium">{e.aktion}</td>
          <td class="text-xs">
            <ZielLink ziel={e.ziel} verweis={e.verweis} />
          </td>
          <td class="text-xs text-muted-foreground">{e.grund}</td>
        </Reihe>
      )}
    </For>
  </Tabelle>
);

/** The tab "Änderungen" of the Protokoll (routes/protokoll.tsx); the page shows it only to owner and technik */
export const Aenderungen = () => (
  <Seitenweise
    laden={(weiter) => betriebQuelle().audit({}, weiter)}
    ladenText={m.audit_laden()}
    zeigen={(eintraege) => <Eintraege eintraege={eintraege()} />}
  />
);
