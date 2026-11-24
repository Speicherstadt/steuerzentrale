import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { appHinweis } from "../daten/app-ansicht.ts";
import { appsQuelle } from "../daten/apps.ts";
import { installationenQuelle } from "../daten/installationen.ts";
import { bestand } from "../daten/quelle.ts";
import { Fehler } from "../seiten/anmeldung-teile.tsx";
import { AppKachel } from "../seiten/app-kachel.tsx";
import { ManifestImportieren, RegistryAbfragen } from "../seiten/app-versionen.tsx";
import { MitInstallationsRecht } from "../seiten/recht.tsx";
import { Hinweisbox, Seitenkopf } from "../teile/karte.tsx";

/**
 * The apps as their manifests describe them (BAULISTE.md, Z-201, Z-203, Z-501): one calm tile per
 * app with its version, its installations and at most one hint; facts, versions, actions and
 * values stand on the app's page (katalog.$app.tsx). The described apps first, then those only
 * imported. Owner and technik import a signed manifest and ask the registries here.
 */

const Katalog = () => {
  const antwort = createMemo(() => installationenQuelle().liste());
  const versionen = createMemo(() => appsQuelle().liste());
  const [meldung, setMeldung] = createSignal("");
  const installiert = (app: string) => {
    const a = antwort();
    return a.ok ? a.daten.filter((i) => i.app === app && i.zustand !== "entfernt") : [];
  };
  const versionenDer = (app: string) => {
    const v = versionen();
    return v.ok ? v.daten.find((x) => x.app === app) : undefined;
  };
  const ids = () => {
    const v = versionen();
    return [
      ...new Set([...bestand().apps.map((a) => a.id), ...(v.ok ? v.daten.map((x) => x.app) : [])]),
    ];
  };
  const neuGeladen = (text?: string) => {
    setMeldung(text ?? "");
    refresh(versionen);
  };
  return (
    <div class="grid gap-6">
      <Seitenkopf
        titel={m.nav_katalog()}
        text={m.apps_text()}
        aktion={
          <MitInstallationsRecht>
            <RegistryAbfragen onAbgefragt={() => neuGeladen()} />
            <ManifestImportieren onImportiert={neuGeladen} />
          </MitInstallationsRecht>
        }
      />
      <Show when={meldung()}>
        <Hinweisbox icon={<Icon icon={CircleCheck} />} titel={m.apps_importieren()}>
          <span role="status">{meldung()}</span>
        </Hinweisbox>
      </Show>
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <Show when={!versionen().ok}>
          <Fehler text={m.apps_versionen_fehler()} />
        </Show>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={ids()}>
            {(id) => (
              <AppKachel
                id={id}
                a={bestand().apps.find((a) => a.id === id)}
                v={versionenDer(id)}
                n={installiert(id).length}
                hinweis={appHinweis(
                  bestand().apps.find((a) => a.id === id),
                  versionenDer(id),
                  installiert(id).map((i) => i.version),
                  bestand().jetzt,
                )}
                onAngelegt={() => refresh(antwort)}
              />
            )}
          </For>
        </div>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/katalog/")({ component: Katalog });
