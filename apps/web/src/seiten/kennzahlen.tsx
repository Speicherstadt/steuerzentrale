import { m } from "@steuerzentrale/ui";
import { createMemo, Loading, Show } from "solid-js";
import { appsQuelle } from "../daten/apps.ts";
import { backupQuelle } from "../daten/backups.ts";
import { anzeige, type InstallationAnsicht } from "../daten/installation-ansicht.ts";
import { bestand, mitDemo } from "../daten/quelle.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import type { Bestand } from "../daten/typen.ts";
import { updateMisslungen } from "../daten/update-texte.ts";
import { planStand } from "../daten/wellen.ts";
import { welleName } from "../rahmen/texte.ts";
import { Anteile, Ring, Segmente, type Ton } from "../teile/diagramme.tsx";
import { Kennzahl } from "../teile/listen.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * The four key figures of the overview (DESIGN.md, "Bausteine"): servers and installations from
 * the Zentrale (BAULISTE.md Z-406), backups too (Z-601), updates too (Z-503); the demo shows its
 * own waves. Each has a small chart, as in Speicherstadt/belegt: a segment per server and per
 * backup, the installations' states as shares, an update's progress as a ring
 */

const AGENT_TON: Record<string, Ton> = { verbunden: "ok", still: "warn", getrennt: "danger" };

export const ServerZahl = (props: { server: ServerAnsicht[] }) => {
  const art = (a: string) => props.server.filter((x) => x.art === a).length;
  return (
    <Kennzahl
      name={m.nav_server()}
      wert={String(props.server.length)}
      marke={
        <Marke class="tabular-nums">
          {m.uebersicht_verbunden({
            n: props.server.filter((x) => x.agent.zustand === "verbunden").length,
            gesamt: props.server.length,
          })}
        </Marke>
      }
      diagramm={
        <Segmente
          teile={props.server.map((s) => ({
            name: s.name,
            ton: AGENT_TON[s.agent.zustand] ?? "leer",
          }))}
        />
      }
      zeile1={m.uebersicht_server_arten({
        gemeinsam: art("gemeinsam"),
        eigen: art("eigen"),
        kunde: art("kunde"),
      })}
      zeile2={m.uebersicht_server_meldung()}
    />
  );
};

export const InstallationenZahl = (props: { installationen: InstallationAnsicht[] }) => {
  const da = () => props.installationen.filter((i) => i.zustand !== "entfernt");
  const laufend = () => da().filter((i) => i.vertragsende === null);
  const n = (h: string) => laufend().filter((i) => anzeige(i) === h).length;
  return (
    <Kennzahl
      name={m.nav_installationen()}
      wert={String(da().length)}
      marke={<Marke class="tabular-nums">{m.uebersicht_gruen({ n: n("gruen") })}</Marke>}
      diagramm={
        <Anteile
          teile={[
            { name: m.health_gruen(), anzahl: n("gruen"), ton: "ok" },
            { name: m.health_gelb(), anzahl: n("gelb"), ton: "warn" },
            { name: m.health_rot(), anzahl: n("rot") + n("gescheitert"), ton: "danger" },
            {
              name: m.health_unbekannt(),
              anzahl: n("unbekannt") + n("wird_eingerichtet"),
              ton: "leer",
            },
          ]}
        />
      }
      zeile1={m.uebersicht_health({
        gelb: n("gelb"),
        rot: n("rot") + n("gescheitert"),
        unbekannt: n("unbekannt") + n("wird_eingerichtet"),
      })}
      zeile2={m.uebersicht_gekuendigt({ n: da().length - laufend().length })}
    />
  );
};

const UpdateDemo = (props: { b: Bestand }) => {
  const plan = () => props.b.plaene[0];
  const stand = () => {
    const p = plan();
    return p && planStand(props.b, p);
  };
  const welle = () => {
    const w = stand()?.welle;
    return w && welleName(w);
  };
  const neu = () =>
    props.b.apps
      .filter((a) => a.ohneManifest)
      .map((a) => m.uebersicht_manifest_fehlt({ app: a.name, version: a.ohneManifest ?? "" }))
      .join(", ") || m.uebersicht_keine_versionen();
  return (
    <Kennzahl
      name={stand() ? `${stand()?.app.name} ${plan()?.version}` : m.nav_updates()}
      wert={stand() ? `${stand()?.fertig}/${stand()?.gesamt}` : "0"}
      marke={<Marke>{welle() ? m.welle_marke({ welle: welle() ?? "" }) : m.welle_fertig()}</Marke>}
      diagramm={
        <Ring anteil={stand() ? (stand()?.fertig ?? 0) / Math.max(1, stand()?.gesamt ?? 1) : 1} />
      }
      zeile1={
        welle() ? m.uebersicht_welle_laeuft({ welle: welle() ?? "" }) : m.uebersicht_wellen_fertig()
      }
      zeile2={neu()}
    />
  );
};

/**
 * Signed in, from GET /api/v1/updates (Z-503): how many installations run the newest version they
 * are offered, how many updates are under way, how many get a newer version and how many last
 * ended without it
 */
const UpdateZentrale = () => {
  const antwort = createMemo(() => appsQuelle().angebote());
  const liste = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  const aktuell = () => liste().filter((i) => i.angeboten.length === 0).length;
  return (
    <Loading fallback={null}>
      <Kennzahl
        name={m.nav_updates()}
        wert={`${aktuell()}/${liste().length}`}
        diagramm={<Ring anteil={liste().length ? aktuell() / liste().length : 1} />}
        marke={
          <Marke class="tabular-nums">
            {m.uebersicht_updates_laufend({ n: liste().filter((i) => i.update.laeuft).length })}
          </Marke>
        }
        zeile1={m.uebersicht_updates_offen({ n: liste().length - aktuell() })}
        zeile2={m.uebersicht_updates_zurueck({
          n: liste().filter((i) => updateMisslungen(i.update)).length,
        })}
      />
    </Loading>
  );
};

export const UpdateZahl = () => (
  <Show when={mitDemo()} fallback={<UpdateZentrale />}>
    <UpdateDemo b={bestand()} />
  </Show>
);

/**
 * The installations with parts to back up whose last run succeeded, and how many test restores
 * failed (Z-602), from GET /api/v1/backups
 */
export const BackupZahl = () => {
  const antwort = createMemo(() => backupQuelle().uebersicht());
  const zeilen = () => {
    const a = antwort();
    return a.ok ? a.daten.filter((z) => z.teile.length > 0) : [];
  };
  const ok = () => zeilen().filter((z) => z.letzter?.ok).length;
  const gescheitert = () => zeilen().filter((z) => z.letzter && !z.letzter.ok).length;
  const pruefGescheitert = () =>
    zeilen().filter((z) => z.pruefRestore.letzter?.ok === false).length;
  return (
    <Loading fallback={null}>
      <Kennzahl
        name={m.bak_letzter_ok()}
        wert={`${ok()}/${zeilen().length}`}
        marke={<Marke>{m.bak_restic()}</Marke>}
        diagramm={
          <Segmente
            teile={zeilen().map((z) => ({
              name: `${z.kundeName} · ${z.app}`,
              ton: !z.letzter ? "leer" : z.letzter.ok ? "ok" : "danger",
            }))}
          />
        }
        zeile1={m.uebersicht_backups_gescheitert({ n: gescheitert() })}
        zeile2={m.uebersicht_pruef_gescheitert({ n: pruefGescheitert() })}
      />
    </Loading>
  );
};
