import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createMemo, Loading, Match, refresh, Switch } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import { appZeilen } from "../daten/apps-liste.ts";
import { appsListeLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { serverQuelle } from "../daten/server.ts";
import { type ServerAnsicht, serverAnsicht } from "../daten/server-ansicht.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { AppsTabelle } from "../seiten/apps-tabelle.tsx";
import { ServerAuslastung } from "../seiten/server-auslastung.tsx";
import { ServerKopf } from "../seiten/server-kopf.tsx";
import { TechnikReiter } from "../seiten/server-technik.tsx";
import { ServerUeberblick } from "../seiten/server-ueberblick.tsx";
import { ZielEreignisse } from "../seiten/ziel-ereignisse.tsx";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";

/**
 * One server (BAULISTE.md Z-304; docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its head
 * with its state and "Neu starten", and its tabs in the URL (`?tab=`): Überblick, Auslastung (the
 * disk over time from its facts), Apps (Z-406), Verlauf (its events and its apps') and Technik
 * (facts, maintenance and reboot, Z-701, every check, Z-702). Load, the pending packages by name
 * and the demo's checks of the operating system only the demo shows.
 */

const REITER = ["ueberblick", "auslastung", "apps", "verlauf", "technik"] as const;
type Reiter = (typeof REITER)[number];

const Detail = (props: { a: ServerAnsicht; neu: () => void }) => {
  const abfrage = Route.useSearch();
  const navigate = useNavigate();
  const b = bestand();
  const antwort = createMemo(() => appsListeLaden());
  const zeilen = createMemo(() => {
    const a = antwort();
    return a.ok
      ? appZeilen({ ...a.daten, jetzt: b.jetzt }).filter((z) => z.a.serverId === props.a.id)
      : [];
  });
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  const waehlen = (tab: string) => {
    const neu = REITER.find((r) => r === tab);
    if (neu)
      void navigate({
        to: "/server/$id",
        params: { id: props.a.id },
        search: { tab: neu },
        replace: true,
      });
  };
  const ziele = () => [`server:${props.a.id}`, ...zeilen().map((z) => `installation:${z.a.id}`)];
  const reiter = () => [
    {
      id: "ueberblick",
      label: m.app_ueberblick(),
      content: () => <ServerUeberblick b={b} a={props.a} zeilen={zeilen()} />,
    },
    {
      id: "auslastung",
      label: m.server_auslastung(),
      content: () => <ServerAuslastung a={props.a} />,
    },
    {
      id: "apps",
      label: m.server_reiter_apps({ n: zeilen().length }),
      content: () => <AppsTabelle zeilen={zeilen()} gruppen={null} jetzt={b.jetzt} />,
    },
    {
      id: "verlauf",
      label: m.app_verlauf(),
      content: () => (
        <Karte>
          <KartenKopf titel={m.nav_ereignisse()} text={m.server_verlauf_text()} />
          <KartenInhalt class="grid gap-4">
            <ZielEreignisse ziele={ziele()} />
          </KartenInhalt>
        </Karte>
      ),
    },
    {
      id: "technik",
      label: m.app_technik(),
      content: () => <TechnikReiter b={b} a={props.a} apps={zeilen().map((z) => z.a.app)} />,
    },
  ];
  return (
    <div class="grid gap-6">
      <ServerKopf b={b} a={props.a} neu={() => props.neu()} />
      <Loading fallback={<p class="text-muted-foreground">{m.server_laden()}</p>}>
        <Fehler text={fehler()} />
        <Tabs
          label={m.server_reiter()}
          initial={abfrage().tab ?? "ueberblick"}
          onChange={waehlen}
          tabs={reiter()}
        />
      </Loading>
    </div>
  );
};

const ServerSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(() => serverQuelle().server(params().id));
  const ansicht = () => {
    const a = antwort();
    return a.ok ? serverAnsicht(a.daten, suche(bestand().server, a.daten.serverId)) : undefined;
  };
  const fehlt = () => {
    const a = antwort();
    return !a.ok && a.status === 404;
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.server_laden()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={ansicht()}>{(a) => <Detail a={a()} neu={() => refresh(antwort)} />}</Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/server/$id")({
  validateSearch: (suche: Record<string, unknown>): { tab?: Reiter } => {
    const tab = REITER.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: ServerSeite,
});
