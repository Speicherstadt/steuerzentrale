import { buttonClass, m } from "@steuerzentrale/ui";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { istGekuendigt } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand } from "../daten/typen.ts";
import { planStand } from "../daten/wellen.ts";
import { aufmerksamkeit, nachHealth } from "../daten/zustand.ts";
import { welleName } from "../rahmen/texte.ts";
import { Hinweisliste } from "../seiten/hinweise.tsx";
import { AuftragTabelle } from "../teile/auftraege.tsx";
import { Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { Ereignisliste, Kennzahl } from "../teile/listen.tsx";
import { Marke } from "../teile/zeichen.tsx";

/** The overview: four key figures, what needs attention worst first, events and jobs (Z-406) */

const ServerZahl = (props: { b: Bestand }) => {
  const s = () => props.b.server;
  const art = (a: string) => s().filter((x) => x.art === a).length;
  return (
    <Kennzahl
      name={m.nav_server()}
      wert={String(s().length)}
      marke={
        <Marke class="tabular-nums">
          {m.uebersicht_verbunden({
            n: s().filter((x) => x.agent.zustand === "verbunden").length,
            gesamt: s().length,
          })}
        </Marke>
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

const InstallationenZahl = (props: { b: Bestand }) => {
  const n = (h: "gruen" | "gelb" | "rot" | "unbekannt") => nachHealth(props.b, h).length;
  return (
    <Kennzahl
      name={m.nav_installationen()}
      wert={String(props.b.installationen.length)}
      marke={<Marke class="tabular-nums">{m.uebersicht_gruen({ n: n("gruen") })}</Marke>}
      zeile1={m.uebersicht_health({ gelb: n("gelb"), rot: n("rot"), unbekannt: n("unbekannt") })}
      zeile2={m.uebersicht_gekuendigt({
        n: props.b.installationen.filter((i) => istGekuendigt(props.b, i)).length,
      })}
    />
  );
};

const UpdateZahl = (props: { b: Bestand }) => {
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
      zeile1={
        welle() ? m.uebersicht_welle_laeuft({ welle: welle() ?? "" }) : m.uebersicht_wellen_fertig()
      }
      zeile2={neu()}
    />
  );
};

const BackupZahl = (props: { b: Bestand }) => {
  const alle = () => props.b.installationen;
  const ok = () => alle().filter((i) => i.backup.ok).length;
  const rot = () => alle().filter((i) => i.pruefRestore === "gescheitert").length;
  return (
    <Kennzahl
      name={m.uebersicht_backups_heute()}
      wert={`${ok()}/${alle().length}`}
      marke={
        <Marke>{rot() ? m.uebersicht_pruef_rot({ n: rot() }) : m.uebersicht_pruef_ok()}</Marke>
      }
      zeile1={m.uebersicht_backups_gescheitert({ n: alle().length - ok() })}
      zeile2={m.uebersicht_pruef_woechentlich()}
    />
  );
};

const Uebersicht = () => {
  const b = bestand();
  const hinweise = aufmerksamkeit(b);
  const klein = buttonClass({ variant: "outline", size: "sm" });
  return (
    <div class="grid gap-4">
      <Seitenkopf titel={m.nav_uebersicht()} text={m.uebersicht_text()} />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServerZahl b={b} />
        <InstallationenZahl b={b} />
        <UpdateZahl b={b} />
        <BackupZahl b={b} />
      </div>
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Karte class="xl:col-span-2">
          <KartenKopf
            titel={m.uebersicht_aufmerksamkeit()}
            text={m.uebersicht_aufmerksamkeit_text({
              n: hinweise.filter((h) => h.schwere !== "info").length,
            })}
          />
          <KartenInhalt>
            <Hinweisliste hinweise={hinweise} />
          </KartenInhalt>
        </Karte>
        <Karte>
          <KartenKopf
            titel={m.uebersicht_ereignisse()}
            text={m.uebersicht_ereignisse_text()}
            aktion={
              <Link to="/ereignisse" class={klein}>
                {m.uebersicht_alle_ereignisse()}
              </Link>
            }
          />
          <KartenInhalt>
            <Ereignisliste ereignisse={b.ereignisse.slice(0, 6)} />
          </KartenInhalt>
        </Karte>
      </div>
      <Karte class="overflow-hidden">
        <KartenKopf
          titel={m.nav_auftraege()}
          text={m.uebersicht_auftraege_text()}
          aktion={
            <Link to="/auftraege" class={klein}>
              {m.uebersicht_alle_auftraege()}
            </Link>
          }
        />
        <div class="border-t">
          <AuftragTabelle
            name={m.uebersicht_auftraege_tabelle()}
            rahmen={false}
            auftraege={b.auftraege.filter((a) => a.zustand !== "fertig")}
          />
        </div>
      </Karte>
    </div>
  );
};

export const Route = createFileRoute("/")({ component: Uebersicht });
