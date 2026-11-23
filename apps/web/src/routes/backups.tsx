import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Loading, Show } from "solid-js";
import { type BackupZeile, backupQuelle } from "../daten/backups.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { LaufText, teileText, zugangText } from "../seiten/backup-teile.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { Kennzahl } from "../teile/listen.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import { Marke } from "../teile/zeichen.tsx";

/*
 * The backups of every installation (BAULISTE.md Z-601; mockup viewBackups): the parts from each
 * manifest, the last run the agent reported with its reason when it failed, and where its own S3
 * access stands, from GET /api/v1/backups (in `dev:demo` from the demo's source, which answers
 * alike). The weekly test restore comes with Z-602.
 */

const appName = (id: string) => bestand().apps.find((a) => a.id === id)?.name ?? id;
const titel = (z: BackupZeile) => `${z.kundeName} · ${appName(z.app)}`;

const LetzterLauf = (props: { z: BackupZeile }) => (
  <Show
    when={props.z.letzter}
    fallback={<span class="text-muted-foreground">{m.bak_kein_lauf()}</span>}
  >
    {(lauf) => (
      <div class="grid gap-0.5">
        <LaufText lauf={lauf()} jetzt={bestand().jetzt} />
        <Show when={!lauf().ok && props.z.letzterErfolg}>
          {(zeit) => (
            <span class="text-muted-foreground">
              {m.bak_letzter_erfolg({ zeit: zeitpunkt(zeit(), bestand().jetzt) })}
            </span>
          )}
        </Show>
      </div>
    )}
  </Show>
);

const Kennzahlen = (props: { zeilen: BackupZeile[] }) => {
  const mitTeilen = () => props.zeilen.filter((z) => z.teile.length > 0);
  const gescheitert = () => mitTeilen().filter((z) => z.letzter && !z.letzter.ok);
  const erfolgreich = () => mitTeilen().filter((z) => z.letzter?.ok);
  return (
    <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Kennzahl
        name={m.bak_letzter_ok()}
        wert={`${erfolgreich().length}/${mitTeilen().length}`}
        marke={<Marke>{m.bak_gescheitert({ n: gescheitert().length })}</Marke>}
        zeile1={gescheitert().map(titel).join(", ") || m.bak_alle()}
        zeile2={m.bak_lauf_regel()}
      />
      <Kennzahl
        name={m.bak_repository()}
        wert="S3"
        marke={<Marke>{m.bak_restic()}</Marke>}
        zeile1={m.bak_schluessel()}
        zeile2={m.bak_ziel()}
      />
    </div>
  );
};

const Liste = (props: { zeilen: BackupZeile[] }) => (
  <Tabelle
    name={m.bak_tabelle()}
    minBreite={880}
    leer={m.installationen_keine()}
    anzahl={props.zeilen.length}
    spalten={[
      { name: m.bak_spalte_installation() },
      { name: m.bak_spalte_teile() },
      { name: m.bak_spalte_letztes() },
      { name: m.bak_spalte_snapshots() },
      { name: m.inst_backup_stand() },
      { name: m.server_spalte_server() },
    ]}
  >
    <For each={props.zeilen}>
      {(z) => (
        <Reihe>
          <td>
            <ZuInstallation id={z.installationId} class="font-medium">
              {titel(z)}
            </ZuInstallation>
          </td>
          <td class="font-mono text-xs">{teileText(z.teile)}</td>
          <td class="text-xs">
            <LetzterLauf z={z} />
          </td>
          <td class="font-mono text-xs">
            {z.letzter?.ok ? z.letzter.teile.map((t) => t.snapshotId).join(", ") : "–"}
          </td>
          <td class="text-xs">{z.teile.length > 0 ? zugangText(z) : "–"}</td>
          <td class="text-xs">
            <ZuServer id={z.serverId}>{z.serverName}</ZuServer>
          </td>
        </Reihe>
      )}
    </For>
  </Tabelle>
);

const Backups = () => {
  const antwort = createMemo(() => backupQuelle().uebersicht());
  const zeilen = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_backups()} text={m.bak_text()} />
      <Loading fallback={<p class="text-muted-foreground">{m.bak_laden()}</p>}>
        <Show when={zeilen()} fallback={<Fehler text={fehler()} />}>
          {(z) => (
            <>
              <Kennzahlen zeilen={z()} />
              <p class="text-xs text-muted-foreground">{m.bak_pruef_spaeter()}</p>
              <Liste zeilen={z()} />
            </>
          )}
        </Show>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/backups")({ component: Backups });
