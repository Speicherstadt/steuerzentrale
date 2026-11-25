import { getLocale, m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { For, Match, Show, Switch } from "solid-js";
import { suche } from "../daten/ableitungen.ts";
import type { Dringlichkeit } from "../daten/betrieb.ts";
import { bestand } from "../daten/quelle.ts";
import type { Schwere } from "../daten/typen.ts";
import type { NeueVersion, ZuTun, ZuTunZeile } from "../daten/zu-tun.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { SchwereSymbol } from "../teile/listen.tsx";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import { idFuer, ZuTunAktionen } from "./zu-tun-aktionen.tsx";
import { zuTunGrund, zuTunTitel } from "./zu-tun-texte.ts";

/*
 * "Zu tun" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): what the Zentrale cannot
 * solve by itself, one row per thing, the most urgent first, each with its reason and its direct
 * actions; under it "Ohne Eile": notes and new tags of the registries without a manifest (Z-501),
 * with the way to the Katalog. Nothing to do: one calm line.
 */

const SYMBOL: Record<Dringlichkeit, Schwere> = {
  stoerung: "krit",
  warnung: "warn",
  hinweis: "info",
};

const linkClass = "underline underline-offset-4 hover:text-foreground";

/** The title, a link to the thing's page where it has one */
const Titel = (props: { zeile: ZuTunZeile }) => (
  <Switch fallback={zuTunTitel(props.zeile.haupt)}>
    <Match when={idFuer(props.zeile.haupt, "installation")}>
      {(id) => <ZuInstallation id={id()}>{zuTunTitel(props.zeile.haupt)}</ZuInstallation>}
    </Match>
    <Match when={idFuer(props.zeile.haupt, "server")}>
      {(id) => <ZuServer id={id()}>{zuTunTitel(props.zeile.haupt)}</ZuServer>}
    </Match>
  </Switch>
);

const Zeile = (props: { zeile: ZuTunZeile; neu: () => void }) => (
  <li class="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 sm:flex-nowrap">
    <div class="flex min-w-0 flex-1 basis-full items-start gap-3 sm:basis-auto">
      <SchwereSymbol schwere={SYMBOL[props.zeile.schwere]} />
      <div class="grid min-w-0 gap-0.5">
        <p class="font-medium leading-snug">
          <Titel zeile={props.zeile} />
        </p>
        <p class="break-words text-muted-foreground">{zuTunGrund(props.zeile)}</p>
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap gap-2 pl-11 sm:pl-0">
      <ZuTunAktionen eintrag={props.zeile.haupt} neu={() => props.neu()} />
    </div>
  </li>
);

/** "Haben 0.13.0 und Kontext 0.1.40" */
const versionenText = (neu: NeueVersion[]) =>
  new Intl.ListFormat(getLocale() === "de" ? "de-DE" : "en-GB").format(
    neu.map((v) => `${suche(bestand().apps, v.app)?.name ?? v.app} ${v.version}`),
  );

const OhneEile = (props: { zeilen: ZuTunZeile[]; neu: NeueVersion[] }) => (
  <Show when={props.zeilen.length > 0 || props.neu.length > 0}>
    <div class="grid gap-1 border-t px-5 py-4 text-muted-foreground">
      <For each={props.zeilen}>
        {(z) => (
          <p>
            {m.zutun_ohne_eile()}{" "}
            <span class="text-foreground">
              <Titel zeile={z} />
            </span>
            {` · ${zuTunGrund(z)}`}
          </p>
        )}
      </For>
      <Show when={props.neu.length > 0}>
        <p>
          {m.zutun_ohne_eile()}{" "}
          <span class="text-foreground">
            {props.neu.length === 1
              ? m.zutun_neue_version({ liste: versionenText(props.neu) })
              : m.zutun_neue_versionen({ liste: versionenText(props.neu) })}
          </span>{" "}
          <Link to="/katalog" class={["text-foreground", linkClass]}>
            {m.zutun_zum_katalog()}
          </Link>
        </p>
      </Show>
    </div>
  </Show>
);

export const ZuTunKarte = (props: {
  zuTun: ZuTun;
  neu: NeueVersion[];
  aktualisieren: () => void;
}) => (
  <Karte class="self-start">
    <KartenKopf titel={m.zutun_titel()} text={m.zutun_text()} />
    <KartenInhalt>
      <Show
        when={props.zuTun.zeilen.length > 0}
        fallback={<p class="text-muted-foreground">{m.zutun_leer()}</p>}
      >
        <ul class="grid grid-cols-[minmax(0,1fr)] divide-y">
          <For each={props.zuTun.zeilen}>
            {(zeile) => <Zeile zeile={zeile} neu={() => props.aktualisieren()} />}
          </For>
        </ul>
      </Show>
    </KartenInhalt>
    <OhneEile zeilen={props.zuTun.ohneEile} neu={props.neu} />
  </Karte>
);
