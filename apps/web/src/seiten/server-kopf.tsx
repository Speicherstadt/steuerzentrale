import { Icon, m } from "@steuerzentrale/ui";
import { Show } from "solid-js";
import type { ServerAnsicht } from "../daten/server-ansicht.ts";
import { serverStand } from "../daten/server-liste.ts";
import type { Bestand } from "../daten/typen.ts";
import { artIcon } from "../teile/zeichen.tsx";
import { NeustartKnopf } from "./server-wartung.tsx";
import { artText, StandWorte } from "./server-zustand.tsx";

/*
 * The head of a server's page (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"), like an
 * app's: its icon, its name and kind, its state in one sentence with its first address and
 * operating system, and "Neu starten" for the roles that may (Z-701); a server only observed
 * (Z-1102) is marked so and offers no reboot.
 */

export const ServerKopf = (props: {
  b: Bestand;
  a: ServerAnsicht;
  fuerKunden: boolean;
  neu: () => void;
}) => (
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-4">
      <span class="flex size-13 shrink-0 items-center justify-center rounded-xl border bg-muted">
        <Icon icon={artIcon(props.a.art)} size={26} />
      </span>
      <div class="grid min-w-0 gap-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <h1 class="text-2xl font-semibold tracking-tight">{props.a.name}</h1>
          <Show when={props.fuerKunden}>
            <span class="text-2xl tracking-tight text-muted-foreground">
              · {artText(props.a.art)}
            </span>
          </Show>
          <Show when={props.a.nurBeobachten}>
            <span
              class="self-center rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
              title={m.server_nur_beobachten_text()}
            >
              {m.server_nur_beobachten()}
            </span>
          </Show>
        </div>
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StandWorte stand={serverStand(props.b, props.a)} jetzt={props.b.jetzt} satz />
          <span class="text-muted-foreground">
            {[props.a.ipv4?.[0] ?? m.server_keine_ip(), props.a.os]
              .filter(Boolean)
              .map((t) => `· ${t}`)
              .join(" ")}
          </span>
        </p>
      </div>
    </div>
    <Show when={!props.a.nurBeobachten}>
      <NeustartKnopf a={props.a} neu={() => props.neu()} />
    </Show>
  </div>
);
