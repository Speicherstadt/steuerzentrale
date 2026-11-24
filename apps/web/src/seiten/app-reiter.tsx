import { m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { Show } from "solid-js";
import type { Einzelansicht } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import type { Zugang } from "../daten/typen.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { InstallationAbwicklung } from "./installation-abwicklung.tsx";
import { VonAussen } from "./installation-aussen.tsx";
import { InstallationBackups } from "./installation-backups.tsx";
import {
  EinrichtungsAngaben,
  EinrichtungsAuftraege,
  InstallationsWerte,
} from "./installation-einrichtung.tsx";
import { UnitsUndHealth, Verlauf } from "./installation-health.tsx";
import { InstallationEinstellungen } from "./installation-reiter.tsx";
import { ZugangHinweis } from "./support-zugang.tsx";
import { ZielEreignisse } from "./ziel-ereignisse.tsx";

/*
 * The tabs of an app's page beside "Überblick" and "Messwerte" (docs/plan.md, "Navigation
 * (Oberfläche 2026-11)"), each with what the page had before, once: its backups with test restore
 * and restore, and what follows a contract's end; its settings; its history of states and its
 * events; and everything technical: units, Linux user, ports, manifest, address and the check from
 * outside, setup jobs and the support access.
 */

export const BackupsReiter = (props: { a: Einzelansicht }) => (
  <div class="grid gap-4">
    <InstallationBackups a={props.a} />
    <InstallationAbwicklung a={props.a} jetzt={bestand().jetzt} />
    <Link to="/backups" class="w-fit underline underline-offset-4">
      {m.app_alle_backups()}
    </Link>
  </div>
);

/** The manifest's settings where the demo knows the app, else the values the Zentrale has */
export const EinstellungenReiter = (props: { a: Einzelansicht }) => (
  <Show when={props.a.demo} fallback={<InstallationsWerte a={props.a} />}>
    {(d) => <InstallationEinstellungen b={bestand()} i={d()} />}
  </Show>
);

export const VerlaufReiter = (props: { a: Einzelansicht }) => (
  <div class="grid gap-4 lg:grid-cols-2">
    <Verlauf verlauf={props.a.verlauf} />
    <Karte>
      <KartenKopf titel={m.nav_ereignisse()} />
      <KartenInhalt class="grid gap-4">
        <ZielEreignisse ziele={[`installation:${props.a.id}`]} />
      </KartenInhalt>
    </Karte>
  </div>
);

export const TechnikReiter = (props: {
  a: Einzelansicht;
  eigener: Zugang | undefined;
  fuerKunden: boolean;
  zugangNeu: () => void;
}) => (
  <div class="grid gap-4">
    <div class="grid gap-4 lg:grid-cols-2">
      <UnitsUndHealth health={props.a.health} />
      <EinrichtungsAngaben a={props.a} />
    </div>
    <Show when={props.a.zustand === "laeuft"}>
      <VonAussen id={props.a.id} host={props.a.host} />
    </Show>
    <EinrichtungsAuftraege auftraege={props.a.auftraege} />
    <Show when={props.fuerKunden && props.a.zustand !== "entfernt"}>
      <ZugangHinweis
        installationId={props.a.id}
        eigener={props.eigener}
        jetzt={bestand().jetzt}
        neu={() => props.zugangNeu()}
      />
    </Show>
  </div>
);
