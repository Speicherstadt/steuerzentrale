import { Icon, m } from "@steuerzentrale/ui";
import {
  CalendarClock,
  CircleArrowUp,
  CircleDashed,
  type IconNode,
} from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { type AppHinweis, neuesteVersion } from "../daten/app-ansicht.ts";
import type { AppDerZentrale } from "../daten/apps.ts";
import type { Manifest } from "../daten/typen.ts";
import { anzahl } from "../rahmen/texte.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Installieren } from "./installieren.tsx";

/*
 * One app on the page Apps: icon, name, a line of description, its version and installations, and
 * at most one hint (DESIGN.md, "Ruhig und dicht"). The whole tile leads to the app's page; its one
 * button opens "App installieren" with the app chosen. Everything else stands on the app's page.
 */

const HINWEIS: Record<AppHinweis["art"], { icon: IconNode; ton: string }> = {
  sperrzeit: { icon: CalendarClock, ton: "text-warn" },
  manifest_fehlt: { icon: CircleDashed, ton: "text-warn" },
  update: { icon: CircleArrowUp, ton: "text-foreground" },
};

const hinweisText = (h: AppHinweis): string => {
  if (h.art === "sperrzeit") return m.apps_hinweis_sperrzeit({ bis: h.bis });
  if (h.art === "manifest_fehlt") return m.apps_hinweis_manifest_fehlt({ version: h.version });
  return m.apps_hinweis_update({ version: h.version });
};

const Hinweis = (props: { h: AppHinweis }) => (
  <p class="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium">
    <Icon icon={HINWEIS[props.h.art].icon} size={16} class={HINWEIS[props.h.art].ton} />
    {hinweisText(props.h)}
  </p>
);

export const AppKachel = (props: {
  id: string;
  a: Manifest | undefined;
  v: AppDerZentrale | undefined;
  n: number;
  hinweis: AppHinweis | undefined;
  onAngelegt: () => void;
}) => {
  const name = () => props.a?.name ?? props.id;
  return (
    <section class="relative flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-5 transition-colors hover:border-foreground/30">
      <div class="flex items-start gap-4">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent">
          <Icon icon={appIcon(props.a?.icon ?? "")} size={24} />
        </span>
        <div class="grid min-w-0 gap-1">
          <h2 class="text-base font-semibold leading-tight">
            <Link
              to="/apps/$id"
              params={{ id: props.id }}
              class="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {name()}
            </Link>
          </h2>
          <p class="line-clamp-2 text-sm text-muted-foreground">
            {props.a?.beschreibung ?? m.apps_nur_importiert()}
          </p>
        </div>
      </div>
      <p class="text-sm text-muted-foreground">
        <Show when={neuesteVersion(props.v)} fallback={m.apps_kein_manifest()}>
          {(v) => (
            <span class="font-medium text-foreground tabular-nums">
              {m.apps_version({ version: v() })}
            </span>
          )}
        </Show>
        {" · "}
        {props.n > 0
          ? anzahl(props.n, m.apps_installation_eins, m.apps_installationen)
          : m.apps_nicht_installiert()}
      </p>
      <Show when={props.hinweis}>{(h) => <Hinweis h={h()} />}</Show>
      <Show when={neuesteVersion(props.v)}>
        <div class="relative z-10 mt-auto self-end">
          <Installieren
            app={props.id}
            klein={{
              text: m.apps_installieren(),
              label: m.apps_installieren_label({ app: name() }),
            }}
            onAngelegt={() => props.onAngelegt()}
          />
        </div>
      </Show>
    </section>
  );
};
