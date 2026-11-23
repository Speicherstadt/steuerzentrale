import { m } from "@steuerzentrale/ui";
import { CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { Match, Show, Switch } from "solid-js";
import type {
  BackupLauf,
  BackupTeil,
  BackupZeile,
  LaufTeil,
  PruefRestoreStand,
  PruefRestoreTeil,
} from "../daten/backups.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Zustand } from "../teile/zeichen.tsx";

/*
 * What the page "Backups" and the tab of an installation both show of its backups (BAULISTE.md
 * Z-601): the parts of its manifest, where its own access stands, the result of a run, and its
 * newest test restore (Z-602).
 */

/** "volume daten, befehl sichern" */
export const teileText = (teile: BackupTeil[]): string =>
  teile.length === 0 ? m.bak_keine_teile() : teile.map((t) => `${t.art} ${t.name}`).join(", ");

/** A part of a run: its tag with the snapshot's short id as restic shows it, or why it failed */
export const laufTeilText = (t: LaufTeil): string =>
  `${t.tag}: ${t.snapshot ? t.snapshot.slice(0, 8) : (t.fehler ?? "–")}`;

/** Where the installation's backups stand before and after its first run */
export const zugangText = (b: Pick<BackupZeile, "zugang" | "eingerichtet">): string => {
  if (b.eingerichtet) return m.bak_zugang_eingerichtet();
  if (b.zugang === "angelegt") return m.bak_zugang_einrichten();
  if (b.zugang === "anlegen") return m.bak_zugang_anlegen();
  if (b.zugang === "loeschen") return m.bak_zugang_loeschen();
  if (b.zugang === "geloescht") return m.bak_zugang_geloescht();
  return m.bak_zugang_keiner();
};

/** A run: its time, or that it failed and why */
export const LaufText = (props: { lauf: BackupLauf; jetzt: number }) => (
  <Show
    when={props.lauf.ok}
    fallback={
      <span class="font-medium text-warn">
        {m.bak_lauf_gescheitert({
          zeit: zeitpunkt(props.lauf.zeitpunkt, props.jetzt),
          grund: props.lauf.grund ?? "–",
        })}
      </span>
    }
  >
    {zeitpunkt(props.lauf.zeitpunkt, props.jetzt)}
  </Show>
);

/** The result of a run as a sign with its words */
export const Ergebnis = (props: { lauf: BackupLauf }) => (
  <Show
    when={props.lauf.ok}
    fallback={
      <Zustand
        icon={TriangleAlert}
        farbe="text-warn"
        text={m.inst_backup_gescheitert({ grund: props.lauf.grund ?? "–" })}
      />
    }
  >
    <Zustand icon={CircleCheck} farbe="text-ok" text={m.inst_backup_erfolgreich()} />
  </Show>
);

/** The newest test restore: under way, when it succeeded, or when it failed and why */
export const pruefText = (p: PruefRestoreStand, jetzt: number): string => {
  if (p.laeuft) return m.pruef_laeuft();
  const l = p.letzter;
  if (!l) return m.pruef_nie();
  const zeit = zeitpunkt(l.zeitpunkt, jetzt);
  return l.ok
    ? m.pruef_lauf_gelungen({ zeit })
    : m.pruef_lauf_gescheitert({ zeit, grund: l.grund ?? "–" });
};

/** A part of a test restore: the snapshot it read, or that it was not restored and why */
export const pruefTeilText = (t: PruefRestoreTeil): string =>
  t.zurueckgespielt && t.snapshot
    ? `${t.tag}: ${t.snapshot.slice(0, 8)}`
    : `${t.tag}: ${m.pruef_teil_nicht()}${t.grund ? ` (${t.grund})` : ""}`;

/**
 * The newest test restore: a good one as a sign, a failed one in the warning's colour (its reason
 * may be long), none or one under way quietly
 */
export const PruefZustand = (props: { p: PruefRestoreStand; jetzt: number }) => (
  <Switch fallback={<span class="text-muted-foreground">{pruefText(props.p, props.jetzt)}</span>}>
    <Match when={!props.p.laeuft && props.p.letzter?.ok === true}>
      <Zustand icon={CircleCheck} farbe="text-ok" text={pruefText(props.p, props.jetzt)} />
    </Match>
    <Match when={!props.p.laeuft && props.p.letzter?.ok === false}>
      <span class="font-medium text-warn">{pruefText(props.p, props.jetzt)}</span>
    </Match>
  </Switch>
);
