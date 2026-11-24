import { gesternAbend } from "@steuerzentrale/planung";
import { Icon, m } from "@steuerzentrale/ui";
import { CircleAlert, CircleCheck } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, Loading, refresh, Show } from "solid-js";
import { alsNaechstes } from "../daten/als-naechstes.ts";
import { appsQuelle } from "../daten/apps.ts";
import { betriebQuelle } from "../daten/betrieb.ts";
import { betriebsartLesen, nurFuerMich } from "../daten/betriebsart.ts";
import { type AppsListe, appsListeLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { vonSelbst } from "../daten/von-selbst.ts";
import { ohneManifest, type ZuTun, zuTun } from "../daten/zu-tun.ts";
import { uhrzeit } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { BackupZahl, InstallationenZahl, ServerZahl, UpdateZahl } from "../seiten/kennzahlen.tsx";
import { AlsNaechstes, VonSelbst } from "../seiten/uebersicht-rechts.tsx";
import { ZuTunKarte } from "../seiten/zu-tun.tsx";

/**
 * The overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): it answers one question, "Brauche
 * ich gerade etwas zu tun?". The verdict as its heading, four tiles, "Zu tun" from GET
 * /api/v1/uebersicht with each row's actions, and beside it "Als Nächstes" and "Von selbst
 * erledigt", computed from what the API returns for the apps, servers, backups and updates. Events
 * and jobs are in the Protokoll.
 */

const LEER: AppsListe = { installationen: [], server: [], backups: [], angebote: [] };

const Urteil = (props: { n: number; jetzt: number }) => (
  <div class="flex items-start gap-4">
    <Show
      when={props.n > 0}
      fallback={<Icon icon={CircleCheck} size={34} class="mt-0.5 shrink-0 text-ok" />}
    >
      <Icon icon={CircleAlert} size={34} class="mt-0.5 shrink-0 text-danger" />
    </Show>
    <div class="grid gap-1">
      <h2 class="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
        {props.n === 0
          ? m.uebersicht_urteil_nichts()
          : props.n === 1
            ? m.uebersicht_urteil_eins()
            : m.uebersicht_urteil({ n: props.n })}
      </h2>
      <p class="text-muted-foreground">
        {props.n === 0
          ? m.uebersicht_stand({ zeit: uhrzeit(props.jetzt) })
          : m.uebersicht_stand_rest({ zeit: uhrzeit(props.jetzt) })}
      </p>
    </div>
  </div>
);

const Inhalt = (props: {
  daten: AppsListe;
  zuTun: ZuTun;
  neu: ReturnType<typeof ohneManifest>;
  fuerKunden: boolean;
  aktualisieren: () => void;
}) => {
  const jetzt = () => bestand().jetzt;
  const seit = () => gesternAbend(jetzt());
  return (
    <>
      <Urteil n={props.zuTun.zeilen.length} jetzt={jetzt()} />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServerZahl server={props.daten.server} fuerKunden={props.fuerKunden} />
        <InstallationenZahl
          installationen={props.daten.installationen}
          fuerKunden={props.fuerKunden}
        />
        <UpdateZahl angebote={props.daten.angebote} />
        <BackupZahl backups={props.daten.backups} seit={seit()} fuerKunden={props.fuerKunden} />
      </div>
      <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ZuTunKarte
          zuTun={props.zuTun}
          neu={props.neu}
          fuerKunden={props.fuerKunden}
          aktualisieren={() => props.aktualisieren()}
        />
        <div class="grid min-w-0 gap-4">
          <AlsNaechstes
            termine={alsNaechstes(
              { ...props.daten, apps: bestand().apps, fuerKunden: props.fuerKunden },
              jetzt(),
            )}
            jetzt={jetzt()}
            fuerKunden={props.fuerKunden}
          />
          <VonSelbst erledigt={vonSelbst(props.daten, seit())} fuerKunden={props.fuerKunden} />
        </div>
      </div>
    </>
  );
};

const Uebersicht = () => {
  const eintraege = createMemo(() => betriebQuelle().uebersicht());
  const daten = createMemo(() => appsListeLaden());
  const katalog = createMemo(() => appsQuelle().liste());
  const art = createMemo(() => betriebsartLesen());
  const fehler = () =>
    [eintraege(), daten()].map((a) => (a.ok ? "" : fehlerText(a))).find(Boolean) ?? "";
  const liste = () => {
    const d = daten();
    return d.ok ? d.daten : LEER;
  };
  const zeilen = () => {
    const e = eintraege();
    return zuTun(e.ok ? e.daten : []);
  };
  // a refused catalog only leaves out the line about new tags
  const neu = () => {
    const k = katalog();
    return ohneManifest(k.ok ? k.daten : []);
  };
  return (
    <div class="grid gap-6">
      <h1 class="sr-only">{m.nav_uebersicht()}</h1>
      <Loading fallback={<p class="text-muted-foreground">{m.uebersicht_laden()}</p>}>
        <Fehler text={fehler()} />
        <Inhalt
          daten={liste()}
          zuTun={zeilen()}
          neu={neu()}
          fuerKunden={!nurFuerMich(art())}
          aktualisieren={() => {
            refresh(eintraege);
            refresh(daten);
          }}
        />
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/")({ component: Uebersicht });
