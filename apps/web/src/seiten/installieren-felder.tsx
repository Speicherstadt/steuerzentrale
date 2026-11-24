import type { Geprueft } from "@steuerzentrale/manifest";
import { Input, m } from "@steuerzentrale/ui";
import { For, Loading, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import type { AppVersion } from "../daten/apps.ts";
import type { ServerDerZentrale } from "../daten/server.ts";
import type { Kunde } from "../daten/typen.ts";
import { ART } from "../teile/zeichen.tsx";
import type { Auswahl } from "./installieren-auswahl.ts";

/**
 * The fields of the dialog "Installieren" that do not come from the manifest: customer, server, app
 * and version among the imported manifests (Z-501); and a file field, which the import uses
 */

const feldKlasse =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] disabled:opacity-50";

type Wahl = { wert: string; text: string };

/** A select with its visible label and an empty first choice, so nothing is chosen by accident */
const Liste = (props: {
  id: string;
  label: string;
  leer: string;
  wahl: Wahl[];
  aktuell: string;
  onWahl: (wert: string) => void;
}) => (
  <div class="grid gap-1.5">
    <label for={props.id} class="text-xs font-medium">
      {props.label}
    </label>
    <select
      id={props.id}
      required
      class={feldKlasse}
      onChange={(event) => props.onWahl(event.currentTarget.value)}
    >
      <option value="" selected={props.aktuell === ""}>
        {props.leer}
      </option>
      <For each={props.wahl}>
        {(w) => (
          <option value={w.wert} selected={w.wert === props.aktuell}>
            {w.text}
          </option>
        )}
      </For>
    </select>
  </div>
);

/** Customers whose contract runs */
const kundenWahl = (k: Antwort<Kunde[]>, jetzt: number): Wahl[] =>
  k.ok
    ? k.daten
        .filter((x) => x.vertrag.ende === null || x.vertrag.ende > jetzt)
        .map((x) => ({ wert: x.id, text: x.name }))
    : [];

const ARTEN = { gemeinsam: "gemeinsam", eigen: "eigen", beim_kunden: "kunde" } as const;

/** Servers that are not revoked, with their kind */
const serverWahl = (s: Antwort<ServerDerZentrale[]>): Wahl[] =>
  s.ok
    ? s.daten
        .filter((x) => x.gesperrtAm === null)
        .map((x) => ({ wert: x.serverId, text: `${x.name} · ${ART[ARTEN[x.art]].text()}` }))
    : [];

/** Customer and server; in "Nur für mich" (Z-805) only the server, the customer is the internal one */
export const ZielWahl = (props: { a: Auswahl; ohneKunde?: boolean }) => (
  <Loading fallback={<p class="text-xs text-muted-foreground">{m.installieren_laden()}</p>}>
    <Show when={!props.ohneKunde}>
      <Liste
        id="installieren-kunde"
        label={m.installieren_kunde()}
        leer={m.installieren_kunde_waehlen()}
        wahl={kundenWahl(props.a.kunden(), Date.now())}
        aktuell={props.a.kundeId()}
        onWahl={props.a.setKundeId}
      />
    </Show>
    <Liste
      id="installieren-server"
      label={m.installieren_server()}
      leer={m.installieren_server_waehlen()}
      wahl={serverWahl(props.a.server())}
      aktuell={props.a.serverId()}
      onWahl={props.a.setServerId}
    />
  </Loading>
);

/** A version with its marks: urgent, pre-release */
const versionText = (v: AppVersion) =>
  [
    v.version,
    v.dringend ? m.version_dringend() : undefined,
    v.vorabversion ? m.version_vorab() : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

/** App and version among the imported manifests; the versions follow the customer and the app */
export const AppWahl = (props: { a: Auswahl }) => (
  <Loading fallback={<p class="text-xs text-muted-foreground">{m.installieren_laden()}</p>}>
    <Liste
      id="installieren-app"
      label={m.installieren_app()}
      leer={m.installieren_app_waehlen()}
      wahl={props.a.angeboteneApps().map((app) => ({ wert: app, text: app }))}
      aktuell={props.a.app()}
      onWahl={props.a.appSetzen}
    />
    <Liste
      id="installieren-version"
      label={m.installieren_version()}
      leer={m.installieren_version_waehlen()}
      wahl={props.a.versionen().map((v) => ({ wert: v.version, text: versionText(v) }))}
      aktuell={props.a.version()}
      onWahl={props.a.versionSetzen}
    />
    <p class="text-xs text-muted-foreground">{m.installieren_version_hinweis()}</p>
  </Loading>
);

/** A file field whose text the dialog keeps; without a name, the file is no field of the form */
export const DateiFeld = (props: {
  label: string;
  hint: string;
  accept: string;
  onText: (text: string) => void;
}) => (
  <Input
    label={props.label}
    hint={props.hint}
    type="file"
    accept={props.accept}
    required
    class="h-auto py-1"
    onChange={(event) => {
      const datei = event.currentTarget.files?.[0];
      if (!datei) return props.onText("");
      void datei.text().then(props.onText, () => props.onText(""));
    }}
  />
);

/** Which app and version the manifest names, or why it cannot be read */
const befund = (g: Geprueft) =>
  g.ok
    ? {
        ok: true,
        text: m.installieren_manifest_gelesen({ app: g.manifest.id, version: g.manifest.version }),
      }
    : { ok: false, text: m.installieren_manifest_ungueltig({ detail: g.fehler.join("; ") }) };

export const ManifestBefund = (props: { geprueft: Geprueft | undefined }) => (
  <Show when={props.geprueft}>
    {(g) => (
      <p
        data-testid="manifest-befund"
        class={["text-xs", befund(g()).ok ? "text-muted-foreground" : "text-danger"]}
      >
        {befund(g()).text}
      </p>
    )}
  </Show>
);
