import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, TriangleAlert } from "@steuerzentrale/ui/icons";
import { createMemo, For, Loading, Show } from "solid-js";
import { type Angebot, appsQuelle, type InstallationsAngebot } from "../daten/apps.ts";
import { welleName } from "../rahmen/texte.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { KommtNoch } from "../teile/kommt-noch.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { Marke, Zustand } from "../teile/zeichen.tsx";
import { Fehler } from "./anmeldung-teile.tsx";

/*
 * The page "Updates" from the Zentrale (BAULISTE.md Z-501): which imported versions each
 * installation is offered (a pre-release only to an internal customer), and what is new in the
 * registries without a manifest. Running an update comes with Z-503, the page says so.
 */

const AngebotsMarke = (props: { v: Angebot }) => (
  <Marke class="font-mono font-normal">
    {props.v.version}
    <Show when={props.v.dringend}>
      <Icon icon={TriangleAlert} size={12} class="text-destructive" label={m.version_dringend()} />
    </Show>
    <Show when={props.v.vorabversion}>
      <span class="font-sans text-muted-foreground">{m.version_vorab()}</span>
    </Show>
  </Marke>
);

const Zeile = (props: { i: InstallationsAngebot }) => (
  <Reihe>
    <td>
      <ZuInstallation id={props.i.installationId} class="font-mono text-xs">
        {props.i.installationId}
      </ZuInstallation>
    </td>
    <td>{props.i.app}</td>
    <td class="font-mono text-xs">{props.i.version}</td>
    <td>{welleName(props.i.intern ? "intern" : "alle")}</td>
    <td>
      <Show
        when={props.i.angeboten.length > 0}
        fallback={<Zustand icon={CircleCheck} farbe="text-ok" text={m.upd_aktuell()} />}
      >
        <div class="flex flex-wrap gap-1">
          <For each={props.i.angeboten}>{(v) => <AngebotsMarke v={v} />}</For>
        </div>
      </Show>
    </td>
  </Reihe>
);

/** The versions each installation is offered */
export const Angebote = () => {
  const antwort = createMemo(() => appsQuelle().angebote());
  const liste = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  return (
    <Karte>
      <KartenKopf titel={m.upd_angebote()} text={m.upd_angebote_text()} />
      <KartenInhalt>
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <Show when={!antwort().ok}>
            <Fehler text={m.apps_versionen_fehler()} />
          </Show>
          <Tabelle
            name={m.upd_angebote()}
            spalten={[
              { name: m.nav_installationen() },
              { name: m.upd_spalte_app() },
              { name: m.upd_spalte_installiert() },
              { name: m.inst_welle() },
              { name: m.upd_spalte_angeboten() },
            ]}
            minBreite={640}
            leer={m.upd_keine_installationen()}
            anzahl={liste().length}
          >
            <For each={liste()}>{(i) => <Zeile i={i} />}</For>
          </Tabelle>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};

/** Versions only the registries have: no update until their manifest is imported */
export const NeuInRegistry = () => {
  const antwort = createMemo(() => appsQuelle().liste());
  const neu = () => {
    const a = antwort();
    return a.ok
      ? a.daten.flatMap((app) =>
          app.versionen
            .filter((v) => v.zustand === "manifest_fehlt")
            .map((v) => ({ app: app.app, version: v.version })),
        )
      : [];
  };
  return (
    <Karte>
      <KartenKopf titel={m.upd_registry()} text={m.upd_registry_text()} />
      <KartenInhalt>
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <ul class="grid gap-2">
            <For
              each={neu()}
              fallback={<li class="text-muted-foreground">{m.uebersicht_keine_versionen()}</li>}
            >
              {(x) => (
                <li class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{x.app}</span>
                  <span class="font-mono text-xs">{x.version}</span>
                  <span class="text-xs text-muted-foreground">
                    {m.apps_version_manifest_fehlt()}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};

/** Signed in: the offers and the registries' news; running them comes with Z-503 */
export const UpdatesDerZentrale = () => (
  <>
    <KommtNoch punkt="Z-503" text={m.upd_ausfuehren_spaeter()} />
    <div class="grid gap-4 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <Angebote />
      </div>
      <NeuInRegistry />
    </div>
  </>
);
