import { buttonClass, Icon, m } from "@steuerzentrale/ui";
import { ExternalLink } from "@steuerzentrale/ui/icons";
import { Show } from "solid-js";
import { type AppZustand, appZustand } from "../daten/apps-liste.ts";
import type { Einzelansicht } from "../daten/installationen-laden.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Mehr } from "./app-mehr.tsx";
import { ZustandWorte } from "./apps-tabelle.tsx";
import { SchreibendeAktion } from "./installation-aktionen.tsx";

/*
 * The head of an app's page (docs/plan.md, "Navigation (Oberfläche 2026-11)"): its icon, "App ·
 * Customer", its state in one sentence and its address; "Öffnen" opens the address, "Neustart" for
 * both roles (Z-405, Z-1204), "Mehr …" the other actions. The actions only while it runs.
 */

/** The state of the head: as in the list, but a well-running app says so in a whole sentence */
const kopfZustand = (a: Einzelansicht): AppZustand | "alles_gut" => {
  const z = appZustand(a, undefined, undefined, Date.now());
  return z.art === "laeuft" ? "alles_gut" : z;
};

const Zustandszeile = (props: { a: Einzelansicht }) => (
  <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <Show
      when={kopfZustand(props.a) !== "alles_gut" && (kopfZustand(props.a) as AppZustand)}
      fallback={<ZustandWorte z={{ art: "laeuft" }} satz={m.app_alles_gut()} />}
    >
      {(z) => <ZustandWorte z={z()} />}
    </Show>
    <span aria-hidden="true" class="text-muted-foreground">
      ·
    </span>
    <a
      href={`https://${props.a.host}`}
      target="_blank"
      rel="noreferrer"
      class="break-all underline underline-offset-4"
    >
      {props.a.host}
    </a>
  </p>
);

export const AppKopf = (props: { a: Einzelansicht; neu: () => void }) => (
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-4">
      <span class="flex size-13 shrink-0 items-center justify-center rounded-xl border bg-muted">
        <Icon icon={appIcon(props.a.appIcon)} size={26} />
      </span>
      <div class="grid min-w-0 gap-1">
        <h1 class="text-2xl font-semibold tracking-tight">
          {props.a.appName}
          <span class="font-normal text-muted-foreground"> · {props.a.kundeName}</span>
        </h1>
        <Zustandszeile a={props.a} />
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <a href={`https://${props.a.host}`} target="_blank" rel="noreferrer" class={buttonClass()}>
        {m.app_oeffnen()}
        <Icon icon={ExternalLink} size={14} />
      </a>
      <Show when={props.a.zustand === "laeuft"}>
        <SchreibendeAktion a={props.a} aktion="neustart" neu={() => props.neu()} />
        <Mehr a={props.a} neu={() => props.neu()} />
      </Show>
    </div>
  </div>
);
