import { Icon, m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, Loading, Match, Show, Switch } from "solid-js";
import { neuesteVersion } from "../daten/app-ansicht.ts";
import { type AppDerZentrale, appsQuelle } from "../daten/apps.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import type { Manifest } from "../daten/typen.ts";
import { standName } from "../rahmen/texte.ts";
import { Fehler } from "../seiten/anmeldung-teile.tsx";
import { AppAktionen, AppEinstellungen, Betrieb, Sperrzeiten } from "../seiten/app-angaben.tsx";
import { VersionenTeil } from "../seiten/app-versionen.tsx";
import { InstallationsListe } from "../seiten/installations-liste.tsx";
import { Installieren } from "../seiten/installieren.tsx";
import { appIcon } from "../teile/app-icon.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * One app (BAULISTE.md Z-201, Z-203, Z-501): its versions, what it needs to run, its freeze
 * windows, the actions its manifest offers, its values per level and the operator's installations
 * of it. An app only imported, without a description, shows its versions and installations.
 */

const Kopf = (props: { id: string; a: Manifest | undefined; v: AppDerZentrale | undefined }) => (
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-4">
      <span class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-accent">
        <Icon icon={appIcon(props.a?.icon ?? "")} size={28} />
      </span>
      <div class="grid min-w-0 gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight">{props.a?.name ?? props.id}</h1>
          <Show when={props.a}>{(a) => <Marke>{standName(a().stand)}</Marke>}</Show>
        </div>
        <p class="text-base text-muted-foreground">
          {props.a?.beschreibung ?? m.apps_nur_importiert()}
        </p>
        <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Show when={neuesteVersion(props.v)} fallback={m.apps_kein_manifest()}>
            {(v) => (
              <span class="font-medium text-foreground tabular-nums">
                {m.apps_version({ version: v() })}
              </span>
            )}
          </Show>
          <Show when={props.a?.quelle}>
            {(q) => (
              <a href={q()} class="underline underline-offset-4 hover:text-foreground">
                {m.apps_quelle()}
              </a>
            )}
          </Show>
        </p>
      </div>
    </div>
    <Show when={neuesteVersion(props.v)}>
      <Installieren app={props.id} onAngelegt={() => undefined} />
    </Show>
  </div>
);

const Installationen = (props: { id: string }) => {
  const antwort = createMemo(() => uebersichtLaden());
  const installationen = () => {
    const a = antwort();
    return a.ok
      ? a.daten.installationen.filter((i) => i.app === props.id && i.zustand !== "entfernt")
      : [];
  };
  return (
    <Karte>
      <KartenKopf titel={m.apps_installationen_titel()} text={m.apps_installationen_text()} />
      <KartenInhalt>
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <InstallationsListe installationen={installationen()} zeige="kunde" />
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};

const Detail = (props: { id: string; a: Manifest | undefined; v: AppDerZentrale | undefined }) => (
  <div class="grid gap-6">
    <Kopf id={props.id} a={props.a} v={props.v} />
    <VersionenTeil a={props.v} jetzt={bestand().jetzt} />
    <Show when={props.a}>
      {(a) => (
        <>
          <Betrieb a={a()} />
          <Sperrzeiten a={a()} jetzt={bestand().jetzt} />
          <div class="grid gap-6 lg:grid-cols-2">
            <AppAktionen a={a()} />
            <AppEinstellungen a={a()} />
          </div>
        </>
      )}
    </Show>
    <Installationen id={props.id} />
  </div>
);

const AppSeite = () => {
  const params = Route.useParams();
  const versionen = createMemo(() => appsQuelle().liste());
  const beschrieben = () => bestand().apps.find((a) => a.id === params().id);
  const importiert = () => {
    const v = versionen();
    return v.ok ? v.daten.find((x) => x.app === params().id) : undefined;
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
      <Switch fallback={<NichtGefunden />}>
        <Match when={beschrieben() || importiert()}>
          <Show when={!versionen().ok}>
            <Fehler text={m.apps_versionen_fehler()} />
          </Show>
          <Detail id={params().id} a={beschrieben()} v={importiert()} />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/apps/$id")({ component: AppSeite });
