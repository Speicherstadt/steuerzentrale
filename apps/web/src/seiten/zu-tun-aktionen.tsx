import { Button, buttonClass, m } from "@steuerzentrale/ui";
import { Link } from "@tanstack/solid-router";
import { createMemo, createSignal, Loading, Match, Show, Switch } from "solid-js";
import type { UebersichtEintrag } from "../daten/betrieb.ts";
import { einzelansichtLaden } from "../daten/installationen-laden.ts";
import { ZuInstallation, ZuServer } from "../teile/verweise.tsx";
import { type Angaben, GrundDialog, LogDialog } from "./installation-aktionen.tsx";

/*
 * The direct actions of a row of "Zu tun" (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): a broken
 * app offers "Log ansehen" and "Neustart" with the rights and dialogs they have on its page (Z-405, both
 * roles since Z-1204); everything else leads to the app or
 * the server, where its other actions are. Nothing here acts without its dialog and reason.
 */

const AUSSEN = buttonClass({ variant: "outline" });

/** Where an entry's thing has its page: an installation, a server, or the log */
const ziel = (
  e: UebersichtEintrag,
): { art: "installation" | "server"; id: string } | { art: "protokoll" } => {
  if (e.art === "agent" || e.art === "pruefung") return { art: "server", id: e.server.serverId };
  if (e.art === "auftrag")
    return e.installation
      ? { art: "installation", id: e.installation.installationId }
      : { art: "server", id: e.server.serverId };
  if (e.art === "ereignis")
    return e.verweis.art === "installation" || e.verweis.art === "server"
      ? { art: e.verweis.art, id: e.verweis.id }
      : { art: "protokoll" };
  return { art: "installation", id: e.installation.installationId };
};

/** The id of the entry's installation or server, if it leads to one of `art` */
export const idFuer = (e: UebersichtEintrag, art: "installation" | "server") => {
  const z = ziel(e);
  return z.art === art && "id" in z ? z.id : undefined;
};

/** Whether the row is about a broken app, which may be looked into and restarted from here */
const kaputt = (e: UebersichtEintrag): string | undefined =>
  e.art === "stoerung" || (e.art === "installation" && e.zustand === "rot")
    ? e.installation.installationId
    : undefined;

const Oeffnen = (props: { eintrag: UebersichtEintrag }) => (
  <Switch
    fallback={
      <Link to="/protokoll" search={{ tab: "ereignisse" }} class={AUSSEN}>
        {m.zutun_protokoll()}
      </Link>
    }
  >
    <Match when={idFuer(props.eintrag, "installation")}>
      {(id) => (
        <ZuInstallation id={id()} class={AUSSEN}>
          {m.zutun_app_oeffnen()}
        </ZuInstallation>
      )}
    </Match>
    <Match when={idFuer(props.eintrag, "server")}>
      {(id) => (
        <ZuServer id={id()} class={AUSSEN}>
          {m.zutun_server_oeffnen()}
        </ZuServer>
      )}
    </Match>
  </Switch>
);

/** Log and restart of a broken app, once its page's data are there; without either, "App öffnen" */
const LogUndNeustart = (props: { a: Angaben; neu: () => void }) => {
  const [offen, setOffen] = createSignal<"log" | "neustart">();
  return (
    <Show
      when={props.a.aktionen.log_auszug || props.a.aktionen.neustart}
      fallback={
        <ZuInstallation id={props.a.id} class={AUSSEN}>
          {m.zutun_app_oeffnen()}
        </ZuInstallation>
      }
    >
      <Show when={props.a.aktionen.log_auszug}>
        <Button onClick={() => setOffen("log")}>{m.zutun_log()}</Button>
      </Show>
      <Show when={props.a.aktionen.neustart}>
        <Button variant="primary" onClick={() => setOffen("neustart")}>
          {m.aktion_neustart()}
        </Button>
      </Show>
      <LogDialog
        a={props.a}
        open={offen() === "log"}
        onClose={() => setOffen(undefined)}
        angefordert={() => undefined}
      />
      <GrundDialog
        a={props.a}
        aktion="neustart"
        open={offen() === "neustart"}
        onClose={() => setOffen(undefined)}
        ausgefuehrt={() => {
          setOffen(undefined);
          props.neu();
        }}
      />
    </Show>
  );
};

const KaputteApp = (props: { id: string; neu: () => void }) => {
  const ansicht = createMemo(() => einzelansichtLaden(props.id));
  return (
    <Loading fallback={null}>
      <Show
        when={(() => {
          const a = ansicht();
          return a.ok && a.daten.zustand === "laeuft" ? a.daten : undefined;
        })()}
        fallback={
          <ZuInstallation id={props.id} class={AUSSEN}>
            {m.zutun_app_oeffnen()}
          </ZuInstallation>
        }
      >
        {(a) => <LogUndNeustart a={a()} neu={() => props.neu()} />}
      </Show>
    </Loading>
  );
};

/** The buttons of a row, by the entry that names it */
export const ZuTunAktionen = (props: { eintrag: UebersichtEintrag; neu: () => void }) => (
  <Show when={kaputt(props.eintrag)} fallback={<Oeffnen eintrag={props.eintrag} />}>
    {(id) => <KaputteApp id={id()} neu={() => props.neu()} />}
  </Show>
);
