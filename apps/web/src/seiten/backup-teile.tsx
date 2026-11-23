import { m } from "@steuerzentrale/ui";
import { CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { Show } from "solid-js";
import type { BackupLauf, BackupTeil, BackupZeile, LaufTeil } from "../daten/backups.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Zustand } from "../teile/zeichen.tsx";

/*
 * What the page "Backups" and the tab of an installation both show of its backups (BAULISTE.md
 * Z-601): the parts of its manifest, where its own access stands, and the result of a run.
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
