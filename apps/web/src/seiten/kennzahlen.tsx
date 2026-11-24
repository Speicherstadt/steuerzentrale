import { m } from "@steuerzentrale/ui";
import { Show } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import type { InstallationsAngebot } from "../daten/apps.ts";
import type { BackupZeile } from "../daten/backups.ts";
import { anzeige, type InstallationAnsicht } from "../daten/installation-ansicht.ts";
import { backupsDerNacht, laufendeWelle, type Welle } from "../daten/kennzahlen.ts";
import { bestand, mitDemo } from "../daten/quelle.ts";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import { planStand } from "../daten/wellen.ts";
import { Anteile, Ring, Segmente, type Ton } from "../teile/diagramme.tsx";
import { Kennzahl } from "../teile/listen.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * The four tiles of the overview (DESIGN.md, "Bausteine"; docs/plan.md, "Übersicht (Oberfläche
 * 2026-11)"): servers and apps from the Zentrale (Z-406), the update wave that runs or the updates
 * that could (Z-503; the demo shows its own waves), last night's backups with the failures named
 * (Z-601, Z-602). Each has a small chart, as in Speicherstadt/belegt: a segment per server and per
 * backup, the apps' states as shares, a wave's progress as a ring. "Nur für mich" (Z-805) names no
 * customer.
 */

const AGENT_TON: Record<string, Ton> = { verbunden: "ok", still: "warn", getrennt: "danger" };

const appName = (app: string) => suche(bestand().apps, app)?.name ?? app;

export const ServerZahl = (props: { server: ServerAnsicht[]; fuerKunden: boolean }) => {
  const art = (a: string) => props.server.filter((x) => x.art === a).length;
  const still = () => props.server.filter((x) => x.agent.zustand !== "verbunden").length;
  return (
    <Kennzahl
      name={m.nav_server()}
      wert={String(props.server.length)}
      marke={
        <Marke class="tabular-nums">
          {m.uebersicht_verbunden({
            n: props.server.length - still(),
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
      zeile1={
        props.fuerKunden
          ? m.uebersicht_server_arten({
              gemeinsam: art("gemeinsam"),
              eigen: art("eigen"),
              kunde: art("kunde"),
            })
          : m.uebersicht_server_arten_selbst({ gemeinsam: art("gemeinsam"), eigen: art("eigen") })
      }
      zeile2={
        still() === 0
          ? m.uebersicht_server_alle()
          : still() === 1
            ? m.uebersicht_server_still_eins()
            : m.uebersicht_server_still({ n: still() })
      }
    />
  );
};

export const InstallationenZahl = (props: {
  installationen: InstallationAnsicht[];
  fuerKunden: boolean;
}) => {
  const da = () => props.installationen.filter((i) => i.zustand !== "entfernt");
  const laufend = () => da().filter((i) => i.vertragsende === null);
  const n = (h: string) => laufend().filter((i) => anzeige(i) === h).length;
  return (
    <Kennzahl
      name={m.nav_apps()}
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
      zeile2={
        props.fuerKunden
          ? m.uebersicht_gekuendigt({ n: da().length - laufend().length })
          : m.uebersicht_apps_arten({ n: new Set(da().map((i) => i.app)).size })
      }
    />
  );
};

/** The wave that runs: its progress as a ring, the other updates beside it */
const WellenZahl = (props: { welle: Welle; moeglich: number }) => (
  <Kennzahl
    name={m.uebersicht_update_name({
      app: appName(props.welle.app),
      version: props.welle.version,
    })}
    wert={`${props.welle.fertig}/${props.welle.gesamt}`}
    marke={<Marke>{m.uebersicht_update_laeuft()}</Marke>}
    diagramm={<Ring anteil={props.welle.fertig / Math.max(1, props.welle.gesamt)} />}
    zeile1={m.uebersicht_update_fertig({ fertig: props.welle.fertig, gesamt: props.welle.gesamt })}
    zeile2={m.uebersicht_update_weitere({ n: props.moeglich })}
  />
);

/** No wave runs: how many apps could get a newer version, and how many run the newest */
const MoeglichZahl = (props: { moeglich: number; gesamt: number }) => (
  <Kennzahl
    name={m.nav_updates()}
    wert={String(props.moeglich)}
    marke={<Marke>{m.uebersicht_update_keine_welle()}</Marke>}
    diagramm={<Ring anteil={(props.gesamt - props.moeglich) / Math.max(1, props.gesamt)} />}
    zeile1={m.uebersicht_updates_moeglich({ n: props.moeglich })}
    zeile2={m.uebersicht_updates_aktuell({ n: props.gesamt - props.moeglich })}
  />
);

/** The demo's own wave plan (src/demo/index.ts), as the page Updates shows it */
const demoWelle = (angebote: InstallationsAngebot[]) => {
  const b = bestand();
  const plan = b.plaene[0];
  const stand = plan && planStand(b, plan);
  if (!plan || !stand?.welle) return laufendeWelle(angebote);
  return {
    welle: { app: plan.app, version: plan.version, fertig: stand.fertig, gesamt: stand.gesamt },
    moeglich: angebote.filter((a) => a.angeboten.length > 0 && a.app !== plan.app).length,
  };
};

export const UpdateZahl = (props: { angebote: InstallationsAngebot[] }) => {
  const stand = () => (mitDemo() ? demoWelle(props.angebote) : laufendeWelle(props.angebote));
  return (
    <Show
      when={stand().welle}
      fallback={<MoeglichZahl moeglich={stand().moeglich} gesamt={props.angebote.length} />}
    >
      {(w) => <WellenZahl welle={w()} moeglich={stand().moeglich} />}
    </Show>
  );
};

/** Last night's backups: a segment per app, the failures by name, failed test restores */
export const BackupZahl = (props: {
  backups: BackupZeile[];
  seit: number;
  fuerKunden: boolean;
}) => {
  const nacht = () => backupsDerNacht(props.backups, props.seit);
  const name = (t: { app: string; kundeName: string }) =>
    props.fuerKunden
      ? m.zutun_app_bei({ app: appName(t.app), kunde: t.kundeName })
      : appName(t.app);
  return (
    <Kennzahl
      name={m.uebersicht_backups_nacht()}
      wert={`${nacht().ok}/${nacht().gesamt}`}
      marke={<Marke>{m.uebersicht_backups_jede_nacht()}</Marke>}
      diagramm={<Segmente teile={nacht().teile.map((t) => ({ name: name(t), ton: t.ton }))} />}
      zeile1={
        nacht().gescheitert.length === 0
          ? m.uebersicht_backups_alle()
          : m.uebersicht_backups_gescheitert({
              n: nacht().gescheitert.length,
              namen: nacht().gescheitert.map(name).join(", "),
            })
      }
      zeile2={
        nacht().pruefGescheitert === 0
          ? m.uebersicht_pruef_ok()
          : nacht().pruefGescheitert === 1
            ? m.uebersicht_pruef_gescheitert_eins()
            : m.uebersicht_pruef_gescheitert({ n: nacht().pruefGescheitert })
      }
    />
  );
};
