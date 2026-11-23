import { Icon, m } from "@steuerzentrale/ui";
import {
  ArchiveX,
  Bell,
  ChevronRight,
  CircleHelp,
  CircleX,
  type IconNode,
  ListX,
  TriangleAlert,
  Unplug,
} from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { For, Match, Show, Switch } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import type { Dringlichkeit, UebersichtEintrag } from "../daten/betrieb.ts";
import { grundText } from "../daten/bewertung.ts";
import { bestand } from "../daten/quelle.ts";
import type { Schwere } from "../daten/typen.ts";
import { vor } from "../format/zeit.ts";
import { SchwereSymbol } from "../teile/listen.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import { aktionsText } from "./installieren-texte.ts";

/**
 * "Braucht Aufmerksamkeit" of the overview (BAULISTE.md Z-406): each entry of GET /api/v1/uebersicht
 * with its reason, worst first as the Zentrale ordered them, leading to its cause
 */

type Text = { icon: IconNode; titel: string; text: string };

const SYMBOL: Record<Dringlichkeit, Schwere> = {
  stoerung: "krit",
  warnung: "warn",
  hinweis: "info",
};

const seit = (t: number | null) => (t === null ? "" : ` · ${vor(t, bestand().jetzt)}`);

/** "Customer · App", the app by the name of its description where there is one */
const installationTitel = (i: { kunde: string; app: string }) =>
  `${i.kunde} · ${suche(bestand().apps, i.app)?.name ?? i.app}`;

/** The icon, title and sentence of an entry */
export const hinweisText = (e: UebersichtEintrag): Text => {
  switch (e.art) {
    case "stoerung":
      return {
        icon: CircleX,
        titel: installationTitel(e.installation),
        text: m.hinweis_stoerung({ grund: grundText(e.grund) }) + seit(e.seit),
      };
    case "installation":
      return {
        icon: e.zustand === "unbekannt" ? CircleHelp : TriangleAlert,
        titel: installationTitel(e.installation),
        text: grundText(e.grund) + seit(e.seit),
      };
    case "agent":
      return {
        icon: Unplug,
        titel: e.server.name,
        text: m.hinweis_agent({
          zustand: e.zustand === "still" ? m.agent_still() : m.agent_getrennt(),
          seit: e.seit === null ? "–" : vor(e.seit, bestand().jetzt),
        }),
      };
    case "pruef_restore":
      return {
        icon: ArchiveX,
        titel: installationTitel(e.installation),
        text: e.gescheitert
          ? m.hinweis_pruef_gescheitert({ grund: e.grund ?? "–" }) + seit(e.seit)
          : m.hinweis_pruef_alt({
              seit: e.seit === null ? m.pruef_nie() : vor(e.seit, bestand().jetzt),
            }),
      };
    case "auftrag":
      return {
        icon: ListX,
        titel: aktionsText(e.aktion),
        text: [
          e.installation ? installationTitel(e.installation) : e.server.name,
          e.fehler ?? m.auftrag_gescheitert(),
        ].join(": "),
      };
    case "ereignis":
      return { icon: Bell, titel: e.text, text: vor(e.seit, bestand().jetzt) };
  }
};

const zeileClass = "flex w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-muted";

const Inhalt = (props: { eintrag: UebersichtEintrag }) => {
  const text = () => hinweisText(props.eintrag);
  return (
    <>
      <SchwereSymbol schwere={SYMBOL[props.eintrag.schwere]} icon={text().icon} />
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">{text().titel}</span>
        <span class="block break-words text-muted-foreground">{text().text}</span>
      </span>
      <Icon icon={ChevronRight} class="text-muted-foreground" />
    </>
  );
};

const id = (e: UebersichtEintrag, art: "installation" | "server" | "auftrag") =>
  e.verweis.art === art ? e.verweis.id : undefined;

/** One entry, a link to the installation, the server, the jobs or the events */
const Eintrag = (props: { eintrag: UebersichtEintrag }) => (
  <Switch
    fallback={
      <Link to="/ereignisse" class={zeileClass}>
        <Inhalt eintrag={props.eintrag} />
      </Link>
    }
  >
    <Match when={id(props.eintrag, "installation")}>
      {(i) => (
        <ZuInstallation id={i()} class={zeileClass}>
          <Inhalt eintrag={props.eintrag} />
        </ZuInstallation>
      )}
    </Match>
    <Match when={id(props.eintrag, "server")}>
      {(s) => (
        <ZuServer id={s()} class={zeileClass}>
          <Inhalt eintrag={props.eintrag} />
        </ZuServer>
      )}
    </Match>
    <Match when={id(props.eintrag, "auftrag")}>
      <Link to="/auftraege" class={zeileClass}>
        <Inhalt eintrag={props.eintrag} />
      </Link>
    </Match>
  </Switch>
);

export const Hinweisliste = (props: { eintraege: UebersichtEintrag[] }) => (
  <Show
    when={props.eintraege.length > 0}
    fallback={<p class="py-3 text-muted-foreground">{m.uebersicht_alles_gut()}</p>}
  >
    <ul class="grid grid-cols-[minmax(0,1fr)] divide-y">
      <For each={props.eintraege}>
        {(eintrag) => (
          <li>
            <Eintrag eintrag={eintrag} />
          </li>
        )}
      </For>
    </ul>
  </Show>
);
