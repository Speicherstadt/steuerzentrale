import { Icon, m } from "@steuerzentrale/ui";
import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Cpu,
  Globe,
  HeartPulse,
  type IconNode,
  KeyRound,
  Layers,
  Link as LinkIcon,
  MemoryStick,
  MonitorSmartphone,
  Package,
  Plug,
  Server,
} from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { type AppDerZentrale, appsQuelle } from "../daten/apps.ts";
import { installationenQuelle } from "../daten/installationen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Ebene, Manifest, OptionaleAktion } from "../daten/typen.ts";
import { speicher } from "../format/zahl.ts";
import { anzahl, standName } from "../rahmen/texte.ts";
import { Fehler } from "../seiten/anmeldung-teile.tsx";
import { ManifestImportieren, RegistryAbfragen, VersionenTeil } from "../seiten/app-versionen.tsx";
import { MitInstallationsRecht } from "../seiten/recht.tsx";
import { appIcon } from "../teile/app-icon.ts";
import { Hinweisbox, Karte, Seitenkopf } from "../teile/karte.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * The apps as their manifests describe them (BAULISTE.md, Z-201, Z-203): facts, values and the
 * actions offered; what an app lacks shows as "nicht unterstützt" with its issue (DESIGN.md). Since
 * Z-501 each with its imported versions and what the registry has new, and the import of a signed
 * manifest; an app imported that the descriptions do not know shows with its versions alone.
 */

type Fakt = { icon: IconNode; text: string; warn?: boolean };

const ANMELDUNG: Record<Manifest["anmeldung"], () => string> = {
  oidc: () => m.apps_anmeldung_oidc(),
  eigen: () => m.apps_anmeldung_eigen(),
  anbieter: () => m.apps_anmeldung_anbieter(),
};

const fakten = (a: Manifest): Fakt[] => {
  const alle: (Fakt | undefined)[] = [
    { icon: Cpu, text: a.architektur.join(", ") },
    { icon: MemoryStick, text: speicher(a.ramMb) },
    a.ports.length ? { icon: Plug, text: m.apps_ports({ ports: a.ports.join(", ") }) } : undefined,
    a.ipv4 ? { icon: Globe, text: m.apps_ipv4(), warn: true } : undefined,
    a.serverFuerSich ? { icon: Server, text: m.apps_fuer_sich(), warn: true } : undefined,
    { icon: KeyRound, text: ANMELDUNG[a.anmeldung]() },
    a.braucht.length
      ? { icon: LinkIcon, text: m.apps_braucht({ was: a.braucht.join(", ") }) }
      : undefined,
    a.optionen.length ? { icon: Layers, text: a.optionen.map((o) => o.id).join(", ") } : undefined,
    {
      icon: HeartPulse,
      text:
        "pfad" in a.health
          ? m.apps_health({ pfad: a.health.pfad })
          : m.apps_health_keine({ grund: a.health.keine }),
      warn: "keine" in a.health,
    },
    ...a.sperrzeiten.map((z) => ({
      icon: CalendarClock,
      text: m.apps_sperrzeit({ von: z.von, bis: z.bis }),
      warn: true,
    })),
    a.beimKunden
      ? { icon: MonitorSmartphone, text: m.apps_beim_kunden({ was: a.beimKunden }) }
      : undefined,
    a.version === null ? { icon: Package, text: m.apps_ohne_image(), warn: true } : undefined,
  ];
  return alle.filter((f): f is Fakt => f !== undefined);
};

const EBENEN: { ebene: Ebene; text: (p: { n: number }) => string }[] = [
  { ebene: "betreiber", text: (p) => m.apps_werte_betreiber(p) },
  { ebene: "installation", text: (p) => m.apps_werte_installation(p) },
  { ebene: "auto", text: (p) => m.apps_werte_auto(p) },
];

const OPTIONAL: Record<OptionaleAktion, () => string> = {
  nur_lesen: () => m.apps_nur_lesen(),
  export: () => m.apps_export(),
};

/** Restart, log excerpt and backup every manifest offers; the optional ones as far as supported */
const Aktionen = (props: { a: Manifest }) => {
  const fehlend = () => new Map(props.a.nichtUnterstuetzt.map((x) => [x.aktion, x]));
  const alle = () => [
    { name: m.apps_neustart(), fehlt: undefined },
    { name: m.apps_log(), fehlt: undefined },
    { name: m.nav_backups(), fehlt: undefined },
    ...(Object.keys(OPTIONAL) as OptionaleAktion[]).map((aktion) => ({
      name: OPTIONAL[aktion](),
      fehlt: fehlend().get(aktion),
    })),
  ];
  return (
    <div class="border-t px-5 py-4">
      <h3 class="mb-2 text-xs font-medium text-muted-foreground">{m.apps_aktionen()}</h3>
      <ul class="flex flex-wrap gap-x-4 gap-y-1">
        <For each={alle()}>
          {(x) => (
            <li class="flex items-center gap-1.5">
              <Icon
                icon={x.fehlt ? CircleDashed : CircleCheck}
                class={x.fehlt ? "text-muted-foreground" : "text-ok"}
              />
              {x.name}
              <Show when={x.fehlt}>
                {(f) => (
                  <span class="text-xs text-muted-foreground">
                    {m.apps_nicht_unterstuetzt()}
                    <Show when={f().issue}>
                      {(issue) => (
                        <>
                          {" "}
                          (
                          <a
                            href={issue().url}
                            class="underline underline-offset-4 hover:text-foreground"
                          >
                            {issue().name}
                          </a>
                          )
                        </>
                      )}
                    </Show>
                  </span>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};

/** The newest available version, and the newer one whose manifest is missing */
const versionsMarke = (v: AppDerZentrale | undefined): string | undefined => {
  const verfuegbar = v?.versionen.find((x) => x.zustand === "verfuegbar")?.version;
  const neu = v?.versionen.find((x) => x.zustand === "manifest_fehlt")?.version;
  if (!verfuegbar) return neu ? m.apps_version_nur_neu({ neu }) : undefined;
  return neu ? m.apps_version_neu({ version: verfuegbar, neu }) : verfuegbar;
};

/** Name, version, stage and how many of the operator's installations run it (Z-406) */
const Kopf = (props: {
  id: string;
  a?: Manifest | undefined;
  v?: AppDerZentrale | undefined;
  n: number;
}) => (
  <div class="flex items-start gap-4 p-5 pb-3">
    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border">
      <Icon icon={appIcon(props.a?.icon ?? "")} size={20} />
    </span>
    <div class="grid min-w-0 flex-1 gap-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-semibold leading-none">{props.a?.name ?? props.id}</h2>
        <Show when={versionsMarke(props.v)}>
          {(text) => <Marke class="font-mono font-normal">{text()}</Marke>}
        </Show>
        <Show when={props.a}>
          {(a) => (
            <Marke class={a().stand === "stabil" ? "bg-accent" : ""}>{standName(a().stand)}</Marke>
          )}
        </Show>
        <Show when={props.n > 0}>
          <Marke class="bg-accent tabular-nums">
            {anzahl(props.n, m.apps_installation_eins, m.apps_installationen)}
          </Marke>
        </Show>
      </div>
      <Show when={props.a}>
        {(a) => (
          <p class="text-muted-foreground">
            {m.apps_beschreibung({ text: a().beschreibung, quelle: a().quelle })}
          </p>
        )}
      </Show>
    </div>
  </div>
);

/** What the description of the app says: facts, values, containers and actions */
const Beschreibung = (props: { a: Manifest }) => (
  <>
    <ul class="flex flex-wrap gap-1.5 px-5 pb-3">
      <For each={fakten(props.a)}>
        {(f) => (
          <li
            class={[
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
              f.warn ? "text-warn" : "text-muted-foreground",
            ]}
          >
            <Icon icon={f.icon} size={12} />
            {f.text}
          </li>
        )}
      </For>
    </ul>
    <p class="px-5 pb-4 text-xs text-muted-foreground">
      {EBENEN.map((e) =>
        e.text({ n: props.a.variablen.filter((v) => v.ebene === e.ebene).length }),
      ).join(", ")}
      {" · "}
      {m.apps_container({ namen: props.a.container.join(", ") })}
    </p>
    <Aktionen a={props.a} />
  </>
);

const AppKarte = (props: {
  id: string;
  a: Manifest | undefined;
  v: AppDerZentrale | undefined;
  n: number;
}) => (
  <Karte>
    <Kopf id={props.id} a={props.a} v={props.v} n={props.n} />
    <Show when={props.a}>{(a) => <Beschreibung a={a()} />}</Show>
    <VersionenTeil a={props.v} jetzt={bestand().jetzt} />
  </Karte>
);

const Apps = () => {
  const antwort = createMemo(() => installationenQuelle().liste());
  const versionen = createMemo(() => appsQuelle().liste());
  const [meldung, setMeldung] = createSignal("");
  const anzahlDer = (app: string) => {
    const a = antwort();
    return a.ok ? a.daten.filter((i) => i.app === app && i.zustand !== "entfernt").length : 0;
  };
  const versionenDer = (app: string) => {
    const v = versionen();
    return v.ok ? v.daten.find((x) => x.app === app) : undefined;
  };
  // the described apps first, then those only imported
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
        titel={m.nav_apps()}
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
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          <For each={ids()}>
            {(id) => (
              <AppKarte
                id={id}
                a={bestand().apps.find((a) => a.id === id)}
                v={versionenDer(id)}
                n={anzahlDer(id)}
              />
            )}
          </For>
        </div>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/apps")({ component: Apps });
