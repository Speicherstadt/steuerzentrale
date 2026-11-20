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
import { For, Show } from "solid-js";
import { installationenDer } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Ebene, Manifest, OptionaleAktion } from "../daten/typen.ts";
import { speicher } from "../format/zahl.ts";
import { anzahl, standName } from "../rahmen/texte.ts";
import { appIcon } from "../teile/app-icon.ts";
import { Karte, Seitenkopf } from "../teile/karte.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * The apps as their manifests describe them (BAULISTE.md, Z-201, Z-203): facts, values and the
 * actions offered; what an app lacks shows as "nicht unterstützt" with its issue (DESIGN.md)
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

const AppKarte = (props: { a: Manifest }) => {
  const n = () => installationenDer(bestand(), props.a.id).length;
  return (
    <Karte>
      <div class="flex items-start gap-4 p-5 pb-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border">
          <Icon icon={appIcon(props.a.icon)} size={20} />
        </span>
        <div class="grid min-w-0 flex-1 gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold leading-none">{props.a.name}</h2>
            <Show when={props.a.version}>
              {(v) => (
                <Marke class="font-mono font-normal">
                  {props.a.ohneManifest
                    ? m.apps_version_neu({ version: v(), neu: props.a.ohneManifest })
                    : v()}
                </Marke>
              )}
            </Show>
            <Marke class={props.a.stand === "stabil" ? "bg-accent" : ""}>
              {standName(props.a.stand)}
            </Marke>
            <Show when={n() > 0}>
              <Marke class="bg-accent tabular-nums">
                {anzahl(n(), m.apps_installation_eins, m.apps_installationen)}
              </Marke>
            </Show>
          </div>
          <p class="text-muted-foreground">
            {m.apps_beschreibung({ text: props.a.beschreibung, quelle: props.a.quelle })}
          </p>
        </div>
      </div>
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
    </Karte>
  );
};

const Apps = () => (
  <div class="grid gap-6">
    <Seitenkopf titel={m.nav_apps()} text={m.apps_text()} />
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
      <For each={bestand().apps}>{(a) => <AppKarte a={a} />}</For>
    </div>
  </div>
);

export const Route = createFileRoute("/apps")({ component: Apps });
