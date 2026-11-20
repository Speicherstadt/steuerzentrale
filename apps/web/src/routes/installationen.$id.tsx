import { Icon, m, Tabs } from "@steuerzentrale/ui";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import {
  appVon,
  istGekuendigt,
  linuxNutzer,
  serverVon,
  suche,
  titel,
} from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Installation } from "../daten/typen.ts";
import {
  InstallationBackups,
  InstallationEinstellungen,
  InstallationEreignisse,
} from "../seiten/installation-reiter.tsx";
import { InstallationZustand } from "../seiten/installation-zustand.tsx";
import { appIcon } from "../teile/app-icon.ts";
import { HealthZeichen, Version } from "../teile/zeichen.tsx";

/**
 * One installation: state, settings from the manifest, snapshots and events. The actions (restart,
 * backup now, log excerpt) come with their items, each with a reason (DESIGN.md)
 */
const Detail = (props: { i: Installation }) => {
  const b = bestand();
  const app = () => appVon(b, props.i.app);
  return (
    <div class="grid gap-6">
      <div class="flex min-w-0 items-center gap-4">
        <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent">
          <Icon icon={appIcon(app().icon)} size={24} />
        </span>
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold tracking-tight">{titel(b, props.i)}</h1>
            <HealthZeichen health={props.i.health} gekuendigt={istGekuendigt(b, props.i)} />
            <Version version={props.i.version} />
          </div>
          <p class="font-mono text-xs break-all text-muted-foreground">
            {props.i.adresse} · {linuxNutzer(props.i)}@{serverVon(b, props.i.server).host}
          </p>
        </div>
      </div>
      <Tabs
        label={m.inst_reiter()}
        tabs={[
          {
            id: "zustand",
            label: m.server_spalte_zustand(),
            content: () => <InstallationZustand b={b} i={props.i} />,
          },
          {
            id: "einstellungen",
            label: m.nav_einstellungen(),
            content: () => <InstallationEinstellungen b={b} i={props.i} />,
          },
          {
            id: "backups",
            label: m.nav_backups(),
            content: () => <InstallationBackups b={b} i={props.i} />,
          },
          {
            id: "ereignisse",
            label: m.nav_ereignisse(),
            content: () => <InstallationEreignisse b={b} i={props.i} />,
          },
        ]}
      />
    </div>
  );
};

const InstallationSeite = () => {
  const i = Route.useLoaderData();
  return <Detail i={i()} />;
};

export const Route = createFileRoute("/installationen/$id")({
  loader: ({ params }) => {
    const i = suche(bestand().installationen, params.id);
    if (!i) throw notFound();
    return i;
  },
  component: InstallationSeite,
});
