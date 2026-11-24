import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import { CalendarClock, CircleCheck, CircleDashed } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import { sperrzeitAktiv } from "../daten/ableitungen.ts";
import type { Ebene, Manifest, OptionaleAktion } from "../daten/typen.ts";
import { speicher } from "../format/zahl.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Marke } from "../teile/zeichen.tsx";

/*
 * The sections of an app's page from its description (BAULISTE.md Z-201, Z-203): what it needs to
 * run, its freeze windows, the actions its manifest offers (a missing one as "nicht unterstützt"
 * with its issue, DESIGN.md) and its values per level. Rows with a name and a value, no chips.
 */

type Zeile = { name: string; wert: JSX.Element };

const Zeilen = (props: { titel: string; zeilen: Zeile[] }) => (
  <div class="grid gap-2">
    <h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{props.titel}</h3>
    <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
      <For each={props.zeilen}>
        {(z) => (
          <>
            <dt class="text-muted-foreground">{z.name}</dt>
            <dd class="mb-1 min-w-0 break-words sm:mb-0">{z.wert}</dd>
          </>
        )}
      </For>
    </dl>
  </div>
);

const ANMELDUNG: Record<Manifest["anmeldung"], () => string> = {
  oidc: () => m.apps_anmeldung_oidc(),
  eigen: () => m.apps_anmeldung_eigen(),
  anbieter: () => m.apps_anmeldung_anbieter(),
};

const liste = (werte: string[]) => (werte.length ? werte.join(", ") : m.apps_keine());
const jaNein = (ja: boolean) => (ja ? m.apps_ja() : m.apps_nein());
const mono = (text: string) => <span class="font-mono">{text}</span>;

const ressourcen = (a: Manifest): Zeile[] => [
  { name: m.apps_ram(), wert: speicher(a.ramMb) },
  { name: m.apps_platte(), wert: `${a.platteGb} GB` },
  { name: m.apps_architektur(), wert: a.architektur.join(", ") },
  { name: m.apps_container_name(), wert: mono(a.container.join(", ")) },
];

const netz = (a: Manifest): Zeile[] => [
  { name: m.apps_ports_name(), wert: a.ports.length ? mono(a.ports.join(", ")) : m.apps_keine() },
  { name: m.apps_ipv4_name(), wert: jaNein(a.ipv4) },
  { name: m.apps_fuer_sich_name(), wert: a.serverFuerSich ? m.apps_fuer_sich_ja() : m.apps_nein() },
];

const dienst = (a: Manifest): Zeile[] => [
  { name: m.apps_anmeldung(), wert: ANMELDUNG[a.anmeldung]() },
  {
    name: m.apps_health_name(),
    wert: "pfad" in a.health ? mono(a.health.pfad) : m.apps_health_keine({ grund: a.health.keine }),
  },
  { name: m.apps_backup(), wert: a.backup },
  ...(a.braucht.length ? [{ name: m.apps_braucht_name(), wert: liste(a.braucht) }] : []),
  ...(a.optionen.length
    ? [{ name: m.apps_optionen(), wert: a.optionen.map((o) => o.name).join(", ") }]
    : []),
  ...(a.beimKunden
    ? [{ name: m.apps_beim_kunden_name(), wert: m.apps_beim_kunden({ was: a.beimKunden }) }]
    : []),
];

/** Resources, network, sign-in, health and backup */
export const Betrieb = (props: { a: Manifest }) => (
  <Karte>
    <KartenKopf titel={m.apps_betrieb()} text={m.apps_betrieb_text()} />
    <KartenInhalt class="grid gap-6">
      <Zeilen titel={m.apps_gruppe_ressourcen()} zeilen={ressourcen(props.a)} />
      <Zeilen titel={m.apps_gruppe_netz()} zeilen={netz(props.a)} />
      <Zeilen titel={m.apps_gruppe_dienst()} zeilen={dienst(props.a)} />
    </KartenInhalt>
  </Karte>
);

/** The monthly freeze windows, the one that holds now marked */
export const Sperrzeiten = (props: { a: Manifest; jetzt: number }) => (
  <Show when={props.a.sperrzeiten.length > 0}>
    <Karte>
      <KartenKopf titel={m.apps_sperrzeiten()} text={m.apps_sperrzeiten_text()} />
      <KartenInhalt>
        <ul class="grid gap-3 text-sm">
          <For each={props.a.sperrzeiten}>
            {(z) => (
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Icon icon={CalendarClock} class="text-warn" />
                <span class="font-medium">{m.apps_sperrzeit_tage({ von: z.von, bis: z.bis })}</span>
                <span class="text-muted-foreground">{z.grund}</span>
                <Show when={sperrzeitAktiv(z, props.jetzt)}>
                  <Marke class="text-warn">{m.apps_sperrzeit_aktiv()}</Marke>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </KartenInhalt>
    </Karte>
  </Show>
);

const OPTIONAL: Record<OptionaleAktion, () => string> = {
  nur_lesen: () => m.apps_nur_lesen(),
  export: () => m.apps_export(),
};

/** Restart, log excerpt and backup every manifest offers; the optional ones as far as supported */
export const AppAktionen = (props: { a: Manifest }) => {
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
    <Karte>
      <KartenKopf titel={m.apps_aktionen()} text={m.apps_aktionen_text()} />
      <KartenInhalt>
        <ul class="grid gap-3 text-sm">
          <For each={alle()}>
            {(x) => (
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon
                  icon={x.fehlt ? CircleDashed : CircleCheck}
                  class={x.fehlt ? "text-muted-foreground" : "text-ok"}
                />
                <span class={x.fehlt ? "text-muted-foreground" : "font-medium"}>{x.name}</span>
                <Show when={x.fehlt}>
                  {(f) => (
                    <span class="text-muted-foreground">
                      – {m.apps_nicht_unterstuetzt()}
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
      </KartenInhalt>
    </Karte>
  );
};

const EBENEN: { ebene: Ebene; name: () => string; text: () => string }[] = [
  {
    ebene: "betreiber",
    name: () => m.apps_ebene_betreiber(),
    text: () => m.apps_ebene_betreiber_text(),
  },
  {
    ebene: "installation",
    name: () => m.apps_ebene_installation(),
    text: () => m.apps_ebene_installation_text(),
  },
  { ebene: "auto", name: () => m.apps_ebene_auto(), text: () => m.apps_ebene_auto_text() },
];

/** How many values each level sets, with a sentence what the level means */
export const AppEinstellungen = (props: { a: Manifest }) => (
  <Karte>
    <KartenKopf titel={m.apps_einstellungen()} text={m.apps_einstellungen_text()} />
    <KartenInhalt>
      <ul class="grid gap-3 sm:grid-cols-3">
        <For each={EBENEN}>
          {(e) => (
            <li class="grid gap-1 rounded-lg border p-4" data-testid="app-ebene">
              <span class="text-2xl font-semibold tabular-nums">
                {props.a.variablen.filter((v) => v.ebene === e.ebene).length}
              </span>
              <span class="font-medium">{e.name()}</span>
              <span class="text-xs text-muted-foreground">{e.text()}</span>
            </li>
          )}
        </For>
      </ul>
    </KartenInhalt>
  </Karte>
);
