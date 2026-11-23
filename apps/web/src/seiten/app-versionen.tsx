import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import {
  CircleCheck,
  CircleDashed,
  FileText,
  RefreshCw,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import { createSignal, For, Show } from "solid-js";
import {
  type AppDerZentrale,
  type AppVersion,
  appsQuelle,
  type Importiert,
} from "../daten/apps.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Marke, Zustand } from "../teile/zeichen.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { DateiFeld } from "./installieren-felder.tsx";
import { installationsFehler } from "./installieren-texte.ts";

/*
 * The versions of an app on the page "Apps" (BAULISTE.md Z-501; design/mockup, viewApps): each
 * imported version, a newer one of the registry as "neue Version, Manifest fehlt", "dringend" and
 * pre-releases marked, what the registry said last; the dialog that imports a signed manifest and
 * the button that asks the registries now, both for owner and technik.
 */

const DURCH: Record<Importiert["durch"], () => string> = {
  mitglied: () => m.apps_importiert_mitglied(),
  befehl: () => m.apps_importiert_befehl(),
  uebernommen: () => m.apps_importiert_uebernommen(),
  anderer_betreiber: () => m.apps_importiert_anderer(),
};

const VersionsZeile = (props: { v: AppVersion; jetzt: number }) => (
  <li class="flex flex-wrap items-center gap-2" data-testid="app-version">
    <span class="font-mono text-xs">{props.v.version}</span>
    <Show
      when={props.v.zustand === "verfuegbar"}
      fallback={
        <Zustand icon={CircleDashed} farbe="text-warn" text={m.apps_version_manifest_fehlt()} />
      }
    >
      <Zustand icon={CircleCheck} farbe="text-ok" text={m.apps_version_verfuegbar()} />
    </Show>
    <Show when={props.v.dringend}>
      <Marke class="text-destructive">
        <Icon icon={TriangleAlert} size={12} />
        {m.version_dringend()}
      </Marke>
    </Show>
    <Show when={props.v.vorabversion}>
      <Marke>{m.version_vorab()}</Marke>
    </Show>
    <Show when={props.v.importiert}>
      {(i) => (
        <span class="text-xs text-muted-foreground">
          {m.apps_importiert({ zeit: zeitpunkt(i().am, props.jetzt), durch: DURCH[i().durch]() })}
        </span>
      )}
    </Show>
  </li>
);

const registryText = (a: AppDerZentrale, jetzt: number): { text: string; warn: boolean } => {
  const r = a.registry;
  if (!r) return { text: m.apps_registry_nie(), warn: false };
  if (r.fehler) return { text: m.apps_registry_fehler({ fehler: r.fehler }), warn: true };
  if (!r.image) return { text: m.apps_registry_ohne_image(), warn: false };
  return {
    text: m.apps_registry_stand({ image: r.image, zeit: zeitpunkt(r.abgefragtAm, jetzt) }),
    warn: false,
  };
};

/** The app's versions, or that none is imported yet */
export const VersionenTeil = (props: { a: AppDerZentrale | undefined; jetzt: number }) => (
  <div class="border-t px-5 py-4">
    <h3 class="mb-2 text-xs font-medium text-muted-foreground">{m.apps_versionen()}</h3>
    <Show when={props.a} fallback={<p class="text-muted-foreground">{m.apps_kein_manifest()}</p>}>
      {(a) => (
        <>
          <ul class="grid gap-1.5">
            <For each={a().versionen}>{(v) => <VersionsZeile v={v} jetzt={props.jetzt} />}</For>
          </ul>
          <p
            class={[
              "mt-2 text-xs",
              registryText(a(), props.jetzt).warn ? "text-warn" : "text-muted-foreground",
            ]}
          >
            {registryText(a(), props.jetzt).text}
          </p>
        </>
      )}
    </Show>
  </div>
);

/** The import's form: both files and the reason; a refusal stays in the dialog */
const ImportFormular = (props: { onFertig: (meldung: string) => void; onAbbruch: () => void }) => {
  const [manifest, setManifest] = createSignal("");
  const [signatur, setSignatur] = createSignal("");
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const grund = felder(event).grund ?? "";
    setLaeuft(true);
    const a = await appsQuelle().importieren({ manifest: manifest(), signatur: signatur() }, grund);
    setLaeuft(false);
    if (!a.ok) return setFehler(installationsFehler(a));
    const { app, version } = a.daten;
    props.onFertig(
      a.daten.neu ? m.apps_import_neu({ app, version }) : m.apps_import_vorhanden({ app, version }),
    );
  };
  return (
    <form class="grid gap-4" onSubmit={senden}>
      <DateiFeld
        label={m.installieren_manifest()}
        hint={m.installieren_manifest_hinweis()}
        accept=".yml,.yaml"
        onText={setManifest}
      />
      <DateiFeld
        label={m.installieren_signatur()}
        hint={m.installieren_signatur_hinweis()}
        accept=".minisig"
        onText={setSignatur}
      />
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.apps_import_grund_platzhalter()}
        hint={m.feld_grund_hinweis()}
      />
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onAbbruch()}>{m.knopf_abbrechen()}</Button>
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {m.apps_import_knopf()}
        </Button>
      </div>
    </form>
  );
};

/** "Manifest importieren" and its dialog; `onImportiert` hears what the Zentrale said */
export const ManifestImportieren = (props: { onImportiert: (meldung: string) => void }) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOffen(true)}>
        <Icon icon={FileText} size={16} />
        {m.apps_importieren()}
      </Button>
      <Dialog
        open={offen()}
        onClose={() => setOffen(false)}
        title={m.apps_importieren()}
        description={m.apps_importieren_text()}
      >
        <Show when={offen()}>
          <ImportFormular
            onAbbruch={() => setOffen(false)}
            onFertig={(meldung) => {
              setOffen(false);
              props.onImportiert(meldung);
            }}
          />
        </Show>
      </Dialog>
    </>
  );
};

/** "Registry abfragen": asks every registry now and waits for their answers */
export const RegistryAbfragen = (props: { onAbgefragt: () => void }) => {
  const [laeuft, setLaeuft] = createSignal(false);
  const abfragen = async () => {
    setLaeuft(true);
    await appsQuelle().abfragen();
    setLaeuft(false);
    props.onAbgefragt();
  };
  return (
    <Button onClick={() => void abfragen()} disabled={laeuft()}>
      <Icon icon={RefreshCw} size={16} />
      {laeuft() ? m.apps_abfragen_laeuft() : m.apps_abfragen()}
    </Button>
  );
};
