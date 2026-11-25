import { Icon, m } from "@steuerzentrale/ui";
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  type IconNode,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import type { ServerStand } from "../daten/server-liste.ts";
import { vor, zeitpunkt } from "../format/zeit.ts";
import { anzahl } from "../rahmen/texte.ts";

/*
 * A server's state in plain words with an icon (docs/plan.md, "Server und Kunden (Oberfläche
 * 2026-11)"), for the table "Server" and the head of a server's page; the icon repeats the words
 * and is hidden from screen readers. What is well stays grey, what needs a look is yellow.
 */

const agentText = (s: Extract<ServerStand, { art: "agent" }>, jetzt: number): string => {
  if (s.letzteMeldung === null) return m.agent_noch_nie();
  const seit = vor(s.letzteMeldung, jetzt);
  return s.zustand === "still" ? m.server_z_still({ seit }) : m.server_z_getrennt({ seit });
};

/** The state in the words of the column; `satz`: the head, where all well is a whole sentence */
export const standText = (s: ServerStand, jetzt: number, satz = false): string => {
  switch (s.art) {
    case "ok":
      return satz ? m.server_alles_gut() : m.server_z_verbunden();
    case "agent":
      return agentText(s, jetzt);
    case "platte":
      return m.server_zustand_platte();
    case "neustart":
      return s.ab === null
        ? m.server_zustand_neustart()
        : m.server_z_neustart_geplant({ zeit: zeitpunkt(s.ab, jetzt) });
    case "pruefen":
      return m.server_z_pruefen();
  }
};

type Zeichen = { icon: IconNode; farbe: string; text: string };

const zeichen = (s: ServerStand): Zeichen => {
  switch (s.art) {
    case "ok":
      return { icon: CircleCheck, farbe: "text-ok", text: "text-muted-foreground" };
    case "agent":
      return s.zustand === "still"
        ? { icon: CircleHelp, farbe: "text-muted-foreground", text: "" }
        : { icon: CircleX, farbe: "text-destructive", text: "text-destructive" };
    default:
      return { icon: TriangleAlert, farbe: "text-warn", text: "text-warn" };
  }
};

export const StandWorte = (props: { stand: ServerStand; jetzt: number; satz?: boolean }) => (
  <span class="inline-flex items-center gap-1.5">
    <Icon
      icon={zeichen(props.stand).icon}
      size={15}
      class={`shrink-0 ${zeichen(props.stand).farbe}`}
    />
    <span class={props.satz ? "" : zeichen(props.stand).text}>
      {standText(props.stand, props.jetzt, props.satz)}
    </span>
  </span>
);

/** "4 Apps · 2 Kunden"; the customers only where they are counted */
export const appsText = (apps: number, kunden: number): string =>
  [
    anzahl(apps, m.server_eine_app, m.server_apps),
    anzahl(kunden, m.server_ein_kunde, m.server_kunden),
  ].join(" · ");
