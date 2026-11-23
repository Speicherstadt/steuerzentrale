import { m } from "@steuerzentrale/ui";
import { Show } from "solid-js";
import { betriebQuelle } from "../daten/betrieb.ts";
import { Ereignisliste } from "../teile/listen.tsx";
import { Seitenweise } from "../teile/seitenweise.tsx";

/**
 * The events of a server, a customer or an installation (BAULISTE.md Z-406): the Zentrale's events
 * whose target is one of `ziele` (`server:<id>`, `installation:<id>`), page by page. Without a
 * target there is nothing to ask: an empty filter would be every event.
 */
export const ZielEreignisse = (props: { ziele: string[] }) => (
  <Show
    when={props.ziele.length > 0}
    fallback={<p class="text-muted-foreground">{m.ereignisse_keine()}</p>}
  >
    <Seitenweise
      laden={(weiter) => betriebQuelle().ereignisse({ ziel: props.ziele }, weiter)}
      ladenText={m.ereig_laden()}
      zeigen={(eintraege) => <Ereignisliste ereignisse={eintraege()} />}
    />
  </Show>
);
