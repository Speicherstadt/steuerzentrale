import { m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createMemo, Loading, Match, refresh, Show, Switch } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type Einzelansicht, einzelansichtLaden } from "../daten/installationen-laden.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { AppKopf } from "../seiten/app-kopf.tsx";
import { AppMesswerte } from "../seiten/app-messwerte.tsx";
import {
  BackupsReiter,
  EinstellungenReiter,
  TechnikReiter,
  VerlaufReiter,
} from "../seiten/app-reiter.tsx";
import { AppUeberblick } from "../seiten/app-ueberblick.tsx";
import { Gescheitert } from "../seiten/installation-einrichtung.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";

/**
 * One app (BAULISTE.md Z-402; docs/plan.md, "Navigation (Oberfläche 2026-11)"): its head with its
 * state, address and actions, after a failed setup the way to remove it, and its tabs in the URL
 * (`?tab=`): Überblick, Messwerte, Backups, Einstellungen, Verlauf and Technik. Each part reads its
 * own source (Z-403 to Z-406, Z-503, Z-601 to Z-604, Z-704).
 */

const REITER = [
  "ueberblick",
  "messwerte",
  "backups",
  "einstellungen",
  "verlauf",
  "technik",
] as const;
type Reiter = (typeof REITER)[number];

const Detail = (props: { a: Einzelansicht; neu: () => void }) => {
  const suche = Route.useSearch();
  const navigate = useNavigate();
  const waehlen = (tab: string) => {
    const neu = REITER.find((r) => r === tab);
    if (neu)
      void navigate({
        to: "/apps/$id",
        params: { id: props.a.id },
        search: { tab: neu },
        replace: true,
      });
  };
  const reiter = () => [
    {
      id: "ueberblick",
      label: m.app_ueberblick(),
      content: () => <AppUeberblick a={props.a} neu={() => props.neu()} />,
    },
    { id: "messwerte", label: m.app_messwerte(), content: () => <AppMesswerte a={props.a} /> },
    { id: "backups", label: m.nav_backups(), content: () => <BackupsReiter a={props.a} /> },
    {
      id: "einstellungen",
      label: m.nav_einstellungen(),
      content: () => <EinstellungenReiter a={props.a} />,
    },
    { id: "verlauf", label: m.app_verlauf(), content: () => <VerlaufReiter a={props.a} /> },
    {
      id: "technik",
      label: m.app_technik(),
      content: () => <TechnikReiter a={props.a} />,
    },
  ];
  return (
    <div class="grid gap-6">
      <AppKopf a={props.a} neu={() => props.neu()} />
      <Show when={props.a.zustand === "gescheitert"}>
        <Gescheitert a={props.a} entfernt={() => props.neu()} />
      </Show>
      <Tabs
        label={m.inst_reiter()}
        initial={suche().tab ?? "ueberblick"}
        onChange={waehlen}
        tabs={reiter()}
      />
    </div>
  );
};

const AppSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(
    (): Promise<Antwort<Einzelansicht>> => einzelansichtLaden(params().id),
  );
  const app = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
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
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden_eine()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={app()}>{(a) => <Detail a={a()} neu={() => refresh(antwort)} />}</Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/apps/$id")({
  validateSearch: (suche: Record<string, unknown>): { tab?: Reiter } => {
    const tab = REITER.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: AppSeite,
});
