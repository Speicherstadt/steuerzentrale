import { For } from "solid-js";

/*
 * Small charts for the key figures of the overview, after Speicherstadt/belegt
 * (src/components/start/Diagramme.tsx): plain SVG and boxes, no chart library. Colour only where it
 * means something (ok, warn, danger, DESIGN.md); what is fine stays in the text colour, what is
 * missing is only the border. Every chart repeats what the text beside it says, so it is hidden
 * from screen readers; each segment names itself in a tooltip for the mouse.
 */

export type Ton = "ok" | "warn" | "danger" | "leer";

const FLAECHE: Record<Ton, string> = {
  ok: "border-foreground bg-foreground",
  warn: "border-warn bg-warn",
  danger: "border-danger bg-danger",
  leer: "border-border",
};

/** One segment per thing (a server, an installation), like a drive's activity lights */
export const Segmente = (props: { teile: { name: string; ton: Ton }[] }) => (
  <div aria-hidden="true" class="flex h-8 w-full items-stretch gap-[3px]">
    <For each={props.teile}>
      {(t) => (
        <span title={t.name} class={["min-w-1 flex-1 rounded-[3px] border", FLAECHE[t.ton]]} />
      )}
    </For>
  </div>
);

/** Shares of a whole as one bar, in the order given; empty shares take no room */
export const Anteile = (props: { teile: { name: string; anzahl: number; ton: Ton }[] }) => {
  const gesamt = () => props.teile.reduce((s, t) => s + t.anzahl, 0);
  return (
    <div aria-hidden="true" class="flex h-3 w-full gap-[3px] overflow-hidden rounded-full">
      <For each={props.teile.filter((t) => t.anzahl > 0)}>
        {(t) => (
          <span
            title={`${t.name}: ${t.anzahl}`}
            class={["h-full rounded-full border", FLAECHE[t.ton]]}
            style={{ "flex-grow": String(t.anzahl / Math.max(1, gesamt())), "flex-basis": "0" }}
          />
        )}
      </For>
    </div>
  );
};

const R = 13;
const UMFANG = 2 * Math.PI * R;

/** A share as a small ring (32 px) with its percentage beside it */
export const Ring = (props: { anteil: number }) => {
  const wert = () => Math.min(1, Math.max(0, props.anteil));
  return (
    <div aria-hidden="true" class="flex items-center gap-2.5">
      <svg aria-hidden="true" viewBox="0 0 32 32" class="size-8 shrink-0 text-foreground">
        <circle cx="16" cy="16" r={R} fill="none" stroke="var(--border)" stroke-width="4" />
        <circle
          cx="16"
          cy="16"
          r={R}
          fill="none"
          stroke="currentColor"
          stroke-width="4"
          stroke-linecap="round"
          stroke-dasharray={`${UMFANG * wert()} ${UMFANG}`}
          transform="rotate(-90 16 16)"
        />
      </svg>
      <span class="font-medium tabular-nums">{Math.round(wert() * 100)} %</span>
    </div>
  );
};
