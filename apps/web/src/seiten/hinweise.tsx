import { Icon, m } from "@steuerzentrale/ui";
import {
  ArchiveX,
  ChevronRight,
  CircleX,
  HardDrive,
  type IconNode,
  LifeBuoy,
  ListX,
  Lock,
  Power,
  ShieldCheck,
  TriangleAlert,
  Unplug,
} from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { For, Match, Switch } from "solid-js";
import { suche, titel } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand } from "../daten/typen.ts";
import type { Hinweis } from "../daten/zustand.ts";
import { vor } from "../format/zeit.ts";
import { auftragName } from "../rahmen/texte.ts";
import { SchwereSymbol } from "../teile/listen.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";

/** "Braucht Aufmerksamkeit" of the overview: each entry with its reason, leading to its cause */

type Text = { icon: IconNode; titel: string; text: string };

const agentText = (zustand: string) => (zustand === "still" ? m.agent_still() : m.agent_getrennt());

/** The icon, title and sentence of an entry */
export const hinweisText = (b: Bestand, h: Hinweis): Text => {
  switch (h.art) {
    case "agent":
      return {
        icon: Unplug,
        titel: h.server.name,
        text: m.hinweis_agent({ zustand: agentText(h.zustand), seit: vor(h.seit, b.jetzt) }),
      };
    case "platte":
      return {
        icon: HardDrive,
        titel: h.server.name,
        text: m.hinweis_platte({ prozent: h.prozent }),
      };
    case "neustart":
      return {
        icon: Power,
        titel: h.server.name,
        text: m.hinweis_neustart({ kernel: h.kernel, zeit: h.wartung }),
      };
    case "zertifikat":
      return { icon: Lock, titel: h.server.name, text: m.hinweis_zertifikat({ tage: h.tage }) };
    case "pakete":
      return { icon: ShieldCheck, titel: h.server.name, text: m.hinweis_pakete({ n: h.anzahl }) };
    case "health":
      return {
        icon: h.health === "rot" ? CircleX : TriangleAlert,
        titel: titel(b, h.installation),
        text: h.grund,
      };
    case "pruef_restore":
      return { icon: ArchiveX, titel: titel(b, h.installation), text: m.hinweis_pruef_restore() };
    case "auftrag": {
      const i =
        h.auftrag.ziel.art === "installation"
          ? suche(b.installationen, h.auftrag.ziel.id)
          : undefined;
      return {
        icon: ListX,
        titel: auftragName(h.auftrag, i && suche(b.apps, i.app)),
        text: h.auftrag.schritt,
      };
    }
    case "support": {
      const i = suche(b.installationen, h.zugang.installation);
      return {
        icon: LifeBuoy,
        titel: m.hinweis_support_titel(),
        text: m.hinweis_support({
          wer: h.zugang.wer,
          ziel: i ? titel(b, i) : h.zugang.installation,
          minuten: h.zugang.restMinuten ?? 0,
        }),
      };
    }
  }
};

const zeileClass = "flex w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-muted";

const Inhalt = (props: { hinweis: Hinweis; text: Text }) => (
  <>
    <SchwereSymbol schwere={props.hinweis.schwere} icon={props.text.icon} />
    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium">{props.text.titel}</span>
      <span class="block text-muted-foreground">{props.text.text}</span>
    </span>
    <Icon icon={ChevronRight} class="text-muted-foreground" />
  </>
);

const serverId = (h: Hinweis) => ("server" in h ? h.server.id : undefined);
const installationId = (h: Hinweis) => ("installation" in h ? h.installation.id : undefined);

/** One entry, a link to the server, the installation, the jobs or the support accesses */
const Eintrag = (props: { hinweis: Hinweis }) => {
  const inhalt = () => (
    <Inhalt hinweis={props.hinweis} text={hinweisText(bestand(), props.hinweis)} />
  );
  return (
    <Switch>
      <Match when={serverId(props.hinweis)}>
        {(id) => (
          <ZuServer id={id()} class={zeileClass}>
            {inhalt()}
          </ZuServer>
        )}
      </Match>
      <Match when={installationId(props.hinweis)}>
        {(id) => (
          <ZuInstallation id={id()} class={zeileClass}>
            {inhalt()}
          </ZuInstallation>
        )}
      </Match>
      <Match when={props.hinweis.art === "auftrag"}>
        <Link to="/auftraege" class={zeileClass}>
          {inhalt()}
        </Link>
      </Match>
      <Match when={props.hinweis.art === "support"}>
        <Link to="/support" class={zeileClass}>
          {inhalt()}
        </Link>
      </Match>
    </Switch>
  );
};

export const Hinweisliste = (props: { hinweise: Hinweis[] }) => (
  <ul class="grid grid-cols-[minmax(0,1fr)] divide-y">
    <For each={props.hinweise}>
      {(hinweis) => (
        <li>
          <Eintrag hinweis={hinweis} />
        </li>
      )}
    </For>
  </ul>
);
