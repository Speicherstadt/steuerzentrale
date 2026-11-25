import { prozent } from "../format/zahl.ts";

/** Bars for progress and load; past the limit the bar turns orange and the number says so too */

export const Balken = (props: { wert: number; warn?: boolean; name: string; class?: string }) => (
  <div
    role="progressbar"
    aria-label={props.name}
    aria-valuenow={props.wert}
    aria-valuemin={0}
    aria-valuemax={100}
    class={["h-2 w-full overflow-hidden rounded-full bg-accent", props.class]}
  >
    <div
      class={["h-full", props.warn ? "bg-warn" : "bg-primary"]}
      style={{ width: `${Math.min(100, props.wert)}%` }}
    />
  </div>
);

/** A short bar with the number beside it, for table cells */
export const Mini = (props: { name: string; wert: number; grenze: number }) => (
  <div class="flex items-center gap-2">
    <span class="w-14 shrink-0">
      <Balken name={props.name} wert={props.wert} warn={props.wert >= props.grenze} class="h-1.5" />
    </span>
    <span
      class={[
        "min-w-10 text-xs whitespace-nowrap tabular-nums",
        props.wert >= props.grenze ? "font-medium text-warn" : "text-muted-foreground",
      ]}
    >
      {prozent(props.wert)}
    </span>
  </div>
);
