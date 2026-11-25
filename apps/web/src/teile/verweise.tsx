import type { JSX } from "@solidjs/web";
import { m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { Match, Switch } from "solid-js";
import { suche, titel } from "../daten/ableitungen.ts";
import type { ZielVerweis as Verweis } from "../daten/betrieb.ts";
import { bestand } from "../daten/quelle.ts";
import type { Ziel } from "../daten/typen.ts";

/** Links to an installation, a server, a customer, and to whatever an entry is about */

const linkClass = "hover:underline hover:underline-offset-4";

export const ZuInstallation = (props: { id: string; class?: string; children: JSX.Element }) => (
  <Link to="/apps/$id" params={{ id: props.id }} class={[linkClass, props.class]}>
    {props.children}
  </Link>
);

export const ZuServer = (props: { id: string; class?: string; children: JSX.Element }) => (
  <Link to="/server/$id" params={{ id: props.id }} class={[linkClass, props.class]}>
    {props.children}
  </Link>
);

export const ZuKunde = (props: { id: string; class?: string; children: JSX.Element }) => (
  <Link to="/kunden/$id" params={{ id: props.id }} class={[linkClass, props.class]}>
    {props.children}
  </Link>
);

/** The target of an event, job or audit entry, as a link where it has a page */
export const ZielVerweis = (props: { ziel: Ziel }) => {
  const b = bestand();
  const installation = () =>
    props.ziel.art === "installation" ? suche(b.installationen, props.ziel.id) : undefined;
  const server = () => (props.ziel.art === "server" ? suche(b.server, props.ziel.id) : undefined);
  const app = () => (props.ziel.art === "app" ? props.ziel : undefined);
  return (
    <Switch fallback={<span>{m.nav_einstellungen()}</span>}>
      <Match when={installation()}>
        {(i) => <ZuInstallation id={i().id}>{titel(b, i())}</ZuInstallation>}
      </Match>
      <Match when={server()}>{(s) => <ZuServer id={s().id}>{s().name}</ZuServer>}</Match>
      <Match when={app()}>
        {(a) => (
          <Link to="/katalog" class={linkClass}>
            {[suche(b.apps, a().id)?.name ?? a().id, a().version].filter(Boolean).join(" ")}
          </Link>
        )}
      </Match>
    </Switch>
  );
};

/**
 * The target of an event or audit entry as the Zentrale names it (BAULISTE.md Z-406): a link with
 * its name where it has a page, else the target as written
 */
export const ZielLink = (props: { ziel: string; verweis: Verweis | null }) => (
  <Switch fallback={<span class="break-all">{props.ziel}</span>}>
    <Match when={props.verweis?.art === "installation" && props.verweis}>
      {(v) => <ZuInstallation id={v().id}>{v().name}</ZuInstallation>}
    </Match>
    <Match when={props.verweis?.art === "server" && props.verweis}>
      {(v) => <ZuServer id={v().id}>{v().name}</ZuServer>}
    </Match>
    <Match when={props.verweis?.art === "kunde" && props.verweis}>
      {(v) => <ZuKunde id={v().id}>{v().name}</ZuKunde>}
    </Match>
    <Match when={props.verweis?.art === "dienst" && props.verweis}>
      {(v) => (
        <Link to="/apps" class={linkClass}>
          {v().name}
        </Link>
      )}
    </Match>
  </Switch>
);
