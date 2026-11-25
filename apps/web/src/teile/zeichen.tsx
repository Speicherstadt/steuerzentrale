import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import {
  CalendarX,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  ClockAlert,
  type IconNode,
  LoaderCircle,
  TriangleAlert,
  Unplug,
} from "@steuerzentrale/ui/icons";
import { Show } from "solid-js";
import type { Anzeige } from "../daten/installation-ansicht.ts";
import type { AgentZustand, Health, Manifest } from "../daten/typen.ts";
import { appIcon } from "./app-icon.ts";

/*
 * State badges (DESIGN.md, "Bausteine"): outlined, the icon in the state colour, the text grey, so
 * colour never carries the meaning alone.
 */

export const Zustand = (props: {
  icon: IconNode;
  farbe: string;
  text: string;
  titel?: string | undefined;
}) => (
  <span
    title={props.titel}
    class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground"
  >
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

const EINRICHTUNG: Record<Exclude<Anzeige, Health>, Darstellung> = {
  wird_eingerichtet: {
    icon: LoaderCircle,
    farbe: "text-info",
    text: () => m.inst_zustand_wird_eingerichtet(),
  },
  gescheitert: {
    icon: CircleX,
    farbe: "text-destructive",
    text: () => m.inst_zustand_gescheitert(),
  },
  entfernt: {
    icon: CircleDashed,
    farbe: "text-muted-foreground",
    text: () => m.inst_zustand_entfernt(),
  },
};

/** An installation's state: of its setup until it runs, then its health (BAULISTE.md Z-402) */
export const InstallationsZeichen = (props: { anzeige: Anzeige; gekuendigt: boolean }) => {
  const einrichtung = () => {
    const a = props.anzeige;
    return a === "wird_eingerichtet" || a === "gescheitert" || a === "entfernt" ? a : undefined;
  };
  return (
    <Show
      when={einrichtung()}
      fallback={<HealthZeichen health={props.anzeige as Health} gekuendigt={props.gekuendigt} />}
    >
      {(e) => (
        <Zustand
          icon={EINRICHTUNG[e()].icon}
          farbe={EINRICHTUNG[e()].farbe}
          text={EINRICHTUNG[e()].text()}
        />
      )}
    </Show>
  );
};

const AGENT: Record<AgentZustand, Omit<Darstellung, "text">> = {
  verbunden: { icon: CircleCheck, farbe: "text-ok" },
  still: { icon: ClockAlert, farbe: "text-warn" },
  getrennt: { icon: Unplug, farbe: "text-destructive" },
};

export const AgentZeichen = (props: { zustand: AgentZustand; text: string }) => (
  <Zustand icon={AGENT[props.zustand].icon} farbe={AGENT[props.zustand].farbe} text={props.text} />
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
