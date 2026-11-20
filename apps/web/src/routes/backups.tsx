import { m } from "@steuerzentrale/ui";
import { CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Match, Switch } from "solid-js";
import { appVon, serverVon, titel } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Installation } from "../daten/typen.ts";
import { gb } from "../format/zahl.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Seitenkopf } from "../teile/karte.tsx";
import { Kennzahl } from "../teile/listen.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { Marke, Zustand } from "../teile/zeichen.tsx";

/** Backups of every installation and of the Zentrale (BAULISTE.md, Z-601 to Z-603) */

const PruefZelle = (props: { i: Installation }) => (
  <Switch fallback={<span class="text-muted-foreground">{m.pruef_offen()}</span>}>
    <Match when={props.i.pruefRestore === "ok"}>
      <Zustand icon={CircleCheck} farbe="text-ok" text={m.pruef_ok()} />
    </Match>
    <Match when={props.i.pruefRestore === "gescheitert"}>
      <Zustand icon={TriangleAlert} farbe="text-warn" text={m.pruef_gescheitert()} />
    </Match>
  </Switch>
);

/** The newest snapshot's size, else nine tenths of the data as a restic repository holds it */
const groesse = (i: Installation) => i.snapshots.find((s) => s.gb !== null)?.gb ?? i.datenGb;

const Backups = () => {
  const b = bestand();
  const alle = b.installationen;
  const ok = alle.filter((i) => i.backup.ok);
  const rot = alle.filter((i) => i.pruefRestore === "gescheitert");
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_backups()} text={m.bak_text()} />
      <div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kennzahl
          name={m.bak_heute()}
          wert={`${ok.length}/${alle.length}`}
          marke={<Marke>{m.bak_zeitfenster()}</Marke>}
          zeile1={
            alle
              .filter((i) => !i.backup.ok)
              .map((i) => titel(b, i))
              .join(", ") || m.bak_alle()
          }
          zeile2={m.bak_regel()}
        />
        <Kennzahl
          name={m.bak_pruef_woche()}
          wert={`${alle.filter((i) => i.pruefRestore === "ok").length}/${alle.length}`}
          marke={<Marke>{m.bak_gescheitert({ n: rot.length })}</Marke>}
          zeile1={rot.map((i) => titel(b, i)).join(", ") || m.bak_alle_gruen()}
          zeile2={m.bak_pruef_text()}
        />
        <Kennzahl
          name={m.bak_repository()}
          wert="S3"
          marke={<Marke>{m.bak_restic()}</Marke>}
          zeile1={m.bak_schluessel()}
          zeile2={m.bak_ziel()}
        />
      </div>
      <Tabelle
        name={m.bak_tabelle()}
        minBreite={880}
        leer={m.installationen_keine()}
        anzahl={alle.length + 1}
        spalten={[
          { name: m.bak_spalte_installation() },
          { name: m.bak_spalte_art() },
          { name: m.bak_spalte_letztes() },
          { name: m.inst_groesse() },
          { name: m.inst_pruef() },
          { name: m.server_spalte_server() },
        ]}
      >
        <For each={alle}>
          {(i) => (
            <Reihe>
              <td>
                <ZuInstallation id={i.id} class="font-medium">
                  {titel(b, i)}
                </ZuInstallation>
              </td>
              <td class="font-mono text-xs">{appVon(b, i.app).backup}</td>
              <td class={["text-xs", !i.backup.ok && "font-medium text-warn"]}>
                {i.backup.ok
                  ? zeitpunkt(i.backup.zeitpunkt, b.jetzt)
                  : m.inst_backup_alt({ zeit: zeitpunkt(i.backup.zeitpunkt, b.jetzt) })}
              </td>
              <td class="font-mono text-xs">{gb(groesse(i))}</td>
              <td>
                <PruefZelle i={i} />
              </td>
              <td class="text-xs">{serverVon(b, i.server).name}</td>
            </Reihe>
          )}
        </For>
        <Reihe class="bg-muted">
          <td class="font-medium">{m.bak_zentrale()}</td>
          <td class="font-mono text-xs">{m.bak_zentrale_art()}</td>
          <td class="text-xs">{m.bak_zentrale_zeit()}</td>
          <td class="font-mono text-xs">{gb(0.1)}</td>
          <td>
            <Zustand icon={CircleCheck} farbe="text-ok" text={m.pruef_ok()} />
          </td>
          <td class="text-xs">{m.app_name()}</td>
        </Reihe>
      </Tabelle>
    </div>
  );
};

export const Route = createFileRoute("/backups")({ component: Backups });
