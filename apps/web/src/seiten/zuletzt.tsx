import type { JSX } from "@solidjs/web";
import { m } from "@steuerzentrale/ui";
import { createMemo, For, Loading } from "solid-js";
import { betriebQuelle } from "../daten/betrieb.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Karte } from "../teile/karte.tsx";

/*
 * The card "Zuletzt passiert" of a tab "Überblick" (an app, a server): the newest three of the
 * Zentrale's events about `ziele` (Z-406) and of what the page adds (an app's jobs), with a link to
 * the whole history below.
 */

export type Eintrag = { zeitpunkt: number; text: string };

export const Zuletzt = (props: { ziele: string[]; dazu?: Eintrag[]; link: JSX.Element }) => {
  const antwort = createMemo(() =>
    props.ziele.length > 0
      ? betriebQuelle().ereignisse({ ziel: props.ziele })
      : Promise.resolve(undefined),
  );
  const eintraege = () => {
    const r = antwort();
    const ereignisse = r?.ok
      ? r.daten.eintraege.map((e) => ({ zeitpunkt: e.zeitpunkt, text: e.text }))
      : [];
    return [...ereignisse, ...(props.dazu ?? [])]
      .sort((x, y) => y.zeitpunkt - x.zeitpunkt)
      .slice(0, 3);
  };
  return (
    <Karte>
      <div class="grid gap-1 p-5 pb-2">
        <h2 class="font-semibold leading-none">{m.app_zuletzt()}</h2>
      </div>
      <Loading fallback={<p class="px-5 pb-5 text-muted-foreground">{m.ereig_laden()}</p>}>
        <ul class="divide-y px-5" data-testid="zuletzt">
          <For
            each={eintraege()}
            fallback={<li class="py-3 text-muted-foreground">{m.ereignisse_keine()}</li>}
          >
            {(e) => (
              <li class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-3">
                <span class="text-xs text-muted-foreground tabular-nums">
                  {zeitpunkt(e.zeitpunkt, bestand().jetzt)}
                </span>
                <span class="break-words">{e.text}</span>
              </li>
            )}
          </For>
        </ul>
      </Loading>
      <div class="border-t px-5 py-3">{props.link}</div>
    </Karte>
  );
};
