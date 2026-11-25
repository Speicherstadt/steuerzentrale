import { Button, Icon, m, Tabs } from "@steuerzentrale/ui";
import { CalendarX, Undo2 } from "@steuerzentrale/ui/icons";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createMemo, createSignal, Loading, Match, refresh, Show, Switch } from "solid-js";
import { loeschungAm } from "../daten/ableitungen.ts";
import { appZeilen } from "../daten/apps-liste.ts";
import { appsListeLaden } from "../daten/installationen-laden.ts";
import { kundeStand } from "../daten/kunde-ansicht.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { bestand } from "../daten/quelle.ts";
import type { Kunde } from "../daten/typen.ts";
import { datum } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { KundeDialoge, KundeKopf, type Offen } from "../seiten/kunde-kopf.tsx";
import { KundeSupport } from "../seiten/kunde-support.tsx";
import { KundeUeberblick } from "../seiten/kunde-ueberblick.tsx";
import { ZielEreignisse } from "../seiten/ziel-ereignisse.tsx";
import { Hinweisbox, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";

/**
 * One customer (BAULISTE.md Z-801; docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * head with its apps in one sentence, its contract and actions, the note of a notice, and its tabs
 * in the URL (`?tab=`): Überblick (apps, contract, contact), Support (its accesses, Z-802) and
 * Verlauf (the events of its apps, Z-406). In "Nur für mich" the menu has no customers
 * (Z-805).
 */

const REITER = ["ueberblick", "support", "verlauf"] as const;
type Reiter = (typeof REITER)[number];

const Gekuendigt = (props: { ende: number; oeffne: (dialog: Offen) => void }) => (
  <Hinweisbox
    icon={<Icon icon={CalendarX} />}
    titel={m.kunde_gekuendigt_zum({ datum: datum(props.ende) })}
  >
    <div class="grid gap-3">
      <p>{m.kunde_gekuendigt_text({ datum: datum(loeschungAm(props.ende)) })}</p>
      <Button class="w-fit" onClick={() => props.oeffne("zuruecknehmen")}>
        <Icon icon={Undo2} />
        {m.kunde_zuruecknehmen()}
      </Button>
    </div>
  </Hinweisbox>
);

const Detail = (props: { k: Kunde; gespeichert: () => void }) => {
  const abfrage = Route.useSearch();
  const navigate = useNavigate();
  const b = bestand();
  const [offen, setOffen] = createSignal<Offen>();
  const antwort = createMemo(() => appsListeLaden());
  const zeilen = createMemo(() => {
    const a = antwort();
    return a.ok
      ? appZeilen({ ...a.daten, jetzt: b.jetzt }).filter((z) => z.a.kundeId === props.k.id)
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
        to: "/kunden/$id",
        params: { id: props.k.id },
        search: { tab: neu },
        replace: true,
      });
  };
  const reiter = () => [
    {
      id: "ueberblick",
      label: m.app_ueberblick(),
      content: () => <KundeUeberblick k={props.k} zeilen={zeilen()} />,
    },
    {
      id: "support",
      label: m.kunde_reiter_support(),
      content: () => <KundeSupport k={props.k} zeilen={zeilen()} />,
    },
    {
      id: "verlauf",
      label: m.app_verlauf(),
      content: () => (
        <Karte>
          <KartenKopf titel={m.kunde_verlauf()} text={m.kunde_verlauf_text()} />
          <KartenInhalt class="grid gap-4">
            <ZielEreignisse ziele={zeilen().map((z) => `installation:${z.a.id}`)} />
          </KartenInhalt>
        </Karte>
      ),
    },
  ];
  return (
    <div class="grid gap-6">
      <KundeKopf k={props.k} stand={kundeStand(zeilen())} oeffne={setOffen} />
      <Show when={props.k.vertrag.ende}>
        {(ende) => <Gekuendigt ende={ende()} oeffne={setOffen} />}
      </Show>
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <Fehler text={fehler()} />
        <Tabs
          label={m.kunde_reiter()}
          initial={abfrage().tab ?? "ueberblick"}
          onChange={waehlen}
          tabs={reiter()}
        />
      </Loading>
      <KundeDialoge k={props.k} offen={offen()} oeffne={setOffen} gespeichert={props.gespeichert} />
    </div>
  );
};

const KundeSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(() => kundenQuelle().kunde(params().id));
  const kunde = () => {
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
    <Loading fallback={<p class="text-muted-foreground">{m.kunde_laden()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={kunde()}>
          {(k) => <Detail k={k()} gespeichert={() => refresh(antwort)} />}
        </Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/kunden/$id")({
  validateSearch: (suche: Record<string, unknown>): { tab?: Reiter } => {
    const tab = REITER.find((r) => r === suche.tab);
    return tab ? { tab } : {};
  },
  component: KundeSeite,
});
