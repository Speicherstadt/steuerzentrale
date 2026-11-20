import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import {
  Building2,
  CalendarX,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClockAlert,
  HardDrive,
  type IconNode,
  Power,
  Server as ServerIcon,
  TriangleAlert,
  Unplug,
  Users,
} from "@steuerzentrale/ui/icons";
import type { AgentZustand, Art, Health, Manifest } from "../daten/typen.ts";
import type { ServerZustand } from "../daten/zustand.ts";
import { appIcon } from "./app-icon.ts";

/*
 * State badges (DESIGN.md, "Bausteine"): outlined, the icon in the state colour, the text grey, so
 * colour never carries the meaning alone.
 */

export const Zustand = (props: { icon: IconNode; farbe: string; text: string }) => (
  <span class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
    <Icon icon={props.icon} size={14} class={props.farbe} />
    {props.text}
  </span>
);

/** A plain outlined badge for a count, a version or a fact */
export const Marke = (props: { class?: string; children: JSX.Element }) => (
  <span
    class={[
      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
      props.class,
    ]}
  >
    {props.children}
  </span>
);

type Darstellung = { icon: IconNode; farbe: string; text: () => string };

const HEALTH: Record<Health, Darstellung> = {
  gruen: { icon: CircleCheck, farbe: "text-ok", text: () => m.health_gruen() },
  gelb: { icon: TriangleAlert, farbe: "text-warn", text: () => m.health_gelb() },
  rot: { icon: CircleX, farbe: "text-destructive", text: () => m.health_rot() },
  unbekannt: { icon: CircleHelp, farbe: "text-muted-foreground", text: () => m.health_unbekannt() },
};

export const HealthZeichen = (props: { health: Health; gekuendigt: boolean }) => {
  const d = () =>
    props.gekuendigt
      ? { icon: CalendarX, farbe: "text-muted-foreground", text: m.health_gekuendigt }
      : HEALTH[props.health];
  return <Zustand icon={d().icon} farbe={d().farbe} text={d().text()} />;
};

const SERVER: Record<ServerZustand, Darstellung> = {
  ok: { icon: CircleCheck, farbe: "text-ok", text: () => m.server_zustand_ok() },
  neustart: { icon: Power, farbe: "text-warn", text: () => m.server_zustand_neustart() },
  platte: { icon: HardDrive, farbe: "text-warn", text: () => m.server_zustand_platte() },
  pruefen: { icon: TriangleAlert, farbe: "text-warn", text: () => m.server_zustand_pruefen() },
  agent: { icon: Unplug, farbe: "text-destructive", text: () => m.server_zustand_agent() },
};

export const ServerZeichen = (props: { zustand: ServerZustand }) => (
  <Zustand
    icon={SERVER[props.zustand].icon}
    farbe={SERVER[props.zustand].farbe}
    text={SERVER[props.zustand].text()}
  />
);

const AGENT: Record<AgentZustand, Omit<Darstellung, "text">> = {
  verbunden: { icon: CircleCheck, farbe: "text-ok" },
  still: { icon: ClockAlert, farbe: "text-warn" },
  getrennt: { icon: Unplug, farbe: "text-destructive" },
};

export const AgentZeichen = (props: { zustand: AgentZustand; text: string }) => (
  <Zustand icon={AGENT[props.zustand].icon} farbe={AGENT[props.zustand].farbe} text={props.text} />
);

export const ART: Record<Art, { icon: IconNode; text: () => string }> = {
  gemeinsam: { icon: Users, text: () => m.server_art_gemeinsam() },
  eigen: { icon: ServerIcon, text: () => m.server_art_eigen() },
  kunde: { icon: Building2, text: () => m.server_art_kunde() },
};

export const artIcon = (art: Art) => ART[art].icon;

export const ArtZeichen = (props: { art: Art }) => (
  <span class="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap">
    <Icon icon={ART[props.art].icon} size={14} />
    {ART[props.art].text()}
  </span>
);

export const AppZeichen = (props: { app: Manifest }) => (
  <Marke>
    <Icon icon={appIcon(props.app.icon)} size={14} />
    {props.app.name}
  </Marke>
);

export const Version = (props: { version: string }) => (
  <Marke class="font-mono font-normal text-muted-foreground">{props.version}</Marke>
);
