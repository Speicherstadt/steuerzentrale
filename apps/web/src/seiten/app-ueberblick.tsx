import type { JSX } from "@solidjs/web";
import { Button, Icon, m } from "@steuerzentrale/ui";
import {
  Activity,
  Archive,
  CircleCheck,
  Globe,
  HardDrive,
  type IconNode,
  RefreshCw,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { appsQuelle } from "../daten/apps.ts";
import { type AussenDerInstallation, aussenQuelle } from "../daten/aussen.ts";
import { laufBytes } from "../daten/backups.ts";
import { betriebQuelle } from "../daten/betrieb.ts";
import type { Einzelansicht } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { slaName } from "../rahmen/texte.ts";
import { Angaben, Karte } from "../teile/karte.tsx";
import { ZuKunde, ZuServer } from "../teile/verweise.tsx";
import { Zustand } from "../teile/zeichen.tsx";
import {
  aussenZeile,
  backupZeile,
  monateOk,
  monateText,
  serverZeile,
  type Versionsstand,
  versionsstand,
  versionText,
} from "./app-ueberblick-texte.ts";
import { pruefText } from "./backup-teile.tsx";
import { BackupJetzt, backupsLaden } from "./installation-backups.tsx";
import { aktionsText, auftragsZustandText } from "./installieren-texte.ts";
import { MitInstallationsRecht } from "./recht.tsx";
import { UpdateDialog } from "./update-dialog.tsx";

/*
 * The tab "Überblick" of an app (docs/plan.md, "Navigation (Oberfläche 2026-11)"): five rows, each
 * from its source and nothing invented, with what to do where there is something: reachable from
 * outside (Z-704), the version and an update offered (Z-503), the last backup (Z-601, Z-602), the
 * availability of this and the last month (Z-704) and the server (Z-304); beside them the customer
 * and the last three events of the app (Z-406).
 */

const Gut = () => <Zustand icon={CircleCheck} farbe="text-ok" text={m.app_in_ordnung()} />;
const Pruefen = () => (
  <Zustand icon={TriangleAlert} farbe="text-warn" text={m.pruefung_pruefen()} />
);

/** A mark for a judgement: in order, to look at, or nothing to judge */
const Urteil = (props: { ok: boolean | null }) => (
  <Show when={props.ok !== null}>
    <Show when={props.ok} fallback={<Pruefen />}>
      <Gut />
    </Show>
  </Show>
);

/** One row: icon, title, one line, and on the right a mark or what to do */
const Punkt = (props: {
  icon: IconNode;
  titel: string;
  text: string;
  testid: string;
  rechts?: JSX.Element;
}) => (
  <li class="flex flex-wrap items-center gap-3 py-3.5 sm:flex-nowrap" data-testid={props.testid}>
    <span class="flex size-8 shrink-0 items-center justify-center rounded-md border">
      <Icon icon={props.icon} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium">{props.titel}</p>
      <p class="break-words text-muted-foreground">{props.text}</p>
    </div>
    <Show when={props.rechts}>
      <div class="ml-11 shrink-0 sm:ml-0">{props.rechts}</div>
    </Show>
  </li>
);

const Erreichbar = (props: { a: Einzelansicht; d: AussenDerInstallation | undefined }) => {
  const z = () => aussenZeile(props.d?.aussen ?? null, bestand().jetzt);
  return (
    <Punkt
      icon={Globe}
      titel={m.app_erreichbar()}
      text={z().text}
      testid="erreichbar"
      rechts={<Urteil ok={z().ok} />}
    />
  );
};

const Version = (props: { a: Einzelansicht; stand: Versionsstand; waehlen: () => void }) => (
  <Punkt
    icon={RefreshCw}
    titel={m.app_version({ version: props.a.version })}
    text={versionText(props.stand)}
    testid="version"
    rechts={
      <Show
        when={props.stand.art === "angeboten"}
        fallback={
          <Show when={props.stand.art === "aktuell"}>
            <Gut />
          </Show>
        }
      >
        <MitInstallationsRecht>
          <Button variant="primary" onClick={() => props.waehlen()}>
            {m.app_aktualisieren()}
          </Button>
        </MitInstallationsRecht>
      </Show>
    }
  />
);

const Backup = (props: { a: Einzelansicht; neu: () => void }) => {
  const antwort = backupsLaden(() => props.a);
  const z = () => {
    const r = antwort();
    if (!r.ok) return { titel: m.app_backup_unbekannt(), text: "" };
    const letzter = r.daten.laeufe[0];
    return backupZeile(
      letzter ?? null,
      letzter ? laufBytes(letzter) : null,
      pruefText(r.daten.pruefRestore, bestand().jetzt),
      bestand().jetzt,
    );
  };
  return (
    <Punkt
      icon={Archive}
      titel={z().titel}
      text={z().text}
      testid="backup"
      rechts={
        <MitInstallationsRecht>
          <BackupJetzt a={props.a} neu={() => props.neu()} />
        </MitInstallationsRecht>
      }
    />
  );
};

const Server = (props: { a: Einzelansicht }) => (
  <Punkt
    icon={HardDrive}
    titel={m.app_server({ name: props.a.serverName })}
    text={serverZeile(props.a.server, bestand().jetzt)}
    testid="server"
    rechts={
      <ZuServer id={props.a.serverId} class="underline underline-offset-4">
        {m.app_server_oeffnen()}
      </ZuServer>
    }
  />
);

/** The five rows; the check from outside only once the app runs, as before it there is none */
const Zeilen = (props: {
  a: Einzelansicht;
  stand: Versionsstand;
  waehlen: () => void;
  neu: () => void;
}) => {
  const aussen = createMemo(() => aussenQuelle().derInstallation(props.a.id));
  const d = () => {
    const r = aussen();
    return r.ok ? r.daten : undefined;
  };
  return (
    <Karte>
      <ul class="divide-y px-5">
        <Loading fallback={<li class="py-3.5 text-muted-foreground">{m.aussen_laden()}</li>}>
          <Erreichbar a={props.a} d={d()} />
        </Loading>
        <Version a={props.a} stand={props.stand} waehlen={() => props.waehlen()} />
        <Loading fallback={<li class="py-3.5 text-muted-foreground">{m.bak_laden()}</li>}>
          <Backup a={props.a} neu={() => props.neu()} />
        </Loading>
        <Loading fallback={null}>
          <Punkt
            icon={Activity}
            titel={m.inst_verfuegbarkeit()}
            text={monateText(d()?.verfuegbarkeit ?? [])}
            testid="verfuegbarkeit-monate"
            rechts={<Urteil ok={monateOk(d()?.verfuegbarkeit ?? [])} />}
          />
        </Loading>
        <Server a={props.a} />
      </ul>
    </Karte>
  );
};

const KundeKarte = (props: { a: Einzelansicht }) => (
  <Karte>
    <div class="grid gap-3 p-5">
      <h2 class="font-semibold leading-none">{m.inst_spalte_kunde()}</h2>
      <Angaben
        zeilen={[
          { name: m.app_kunde_name(), wert: props.a.kundeName },
          ...(props.a.kunde
            ? [
                {
                  name: m.app_kunde_vertrag(),
                  wert: props.a.kunde.vertrag.ende
                    ? m.apps_gekuendigt({ datum: datum(props.a.kunde.vertrag.ende) })
                    : m.app_vertrag_seit({
                        sla: slaName(props.a.kunde.vertrag.sla),
                        datum: datum(props.a.kunde.vertrag.beginn),
                      }),
                },
                { name: m.app_kunde_kontakt(), wert: props.a.kunde.kontakt.email },
              ]
            : []),
        ]}
      />
      <ZuKunde id={props.a.kundeId} class="w-fit underline underline-offset-4">
        {m.app_kunde_oeffnen()}
      </ZuKunde>
    </div>
  </Karte>
);

const Zuletzt = (props: { a: Einzelansicht }) => {
  const antwort = createMemo(() =>
    betriebQuelle().ereignisse({ ziel: [`installation:${props.a.id}`] }),
  );
  // its events and its jobs (setup, removal) together, the newest three
  const eintraege = () => {
    const r = antwort();
    const ereignisse = r.ok
      ? r.daten.eintraege.map((e) => ({ zeitpunkt: e.zeitpunkt, text: e.text }))
      : [];
    const auftraege = props.a.auftraege.map((x) => ({
      zeitpunkt: x.geaendertAm,
      text: `${aktionsText(x.aktion)}: ${auftragsZustandText(x.zustand)}`,
    }));
    return [...ereignisse, ...auftraege].sort((x, y) => y.zeitpunkt - x.zeitpunkt).slice(0, 3);
  };
  return (
    <Karte>
      <div class="grid gap-1 p-5 pb-2">
        <h2 class="font-semibold leading-none">{m.app_zuletzt()}</h2>
      </div>
      <Loading fallback={<p class="px-5 pb-5 text-muted-foreground">{m.ereig_laden()}</p>}>
        <ul class="divide-y px-5" data-testid="zuletzt">
          <For
            each={eintraege()}
            fallback={<li class="py-3 text-muted-foreground">{m.ereignisse_keine()}</li>}
          >
            {(e) => (
              <li class="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-3">
                <span class="text-xs text-muted-foreground tabular-nums">
                  {zeitpunkt(e.zeitpunkt, bestand().jetzt)}
                </span>
                <span class="break-words">{e.text}</span>
              </li>
            )}
          </For>
        </ul>
      </Loading>
      <div class="border-t px-5 py-3">
        <Link
          to="/apps/$id"
          params={{ id: props.a.id }}
          search={{ tab: "verlauf" }}
          class="underline underline-offset-4"
        >
          {m.app_ganzer_verlauf()}
        </Link>
      </div>
    </Karte>
  );
};

export const AppUeberblick = (props: {
  a: Einzelansicht;
  fuerKunden: boolean;
  neu: () => void;
}) => {
  const [gewaehlt, setGewaehlt] = createSignal(false);
  const [hinweis, setHinweis] = createSignal("");
  const angebote = createMemo(() => appsQuelle().angebote());
  const stand = (): Versionsstand => {
    const r = angebote();
    return versionsstand(
      props.a,
      r.ok ? r.daten.find((x) => x.installationId === props.a.id) : undefined,
    );
  };
  const angebot = () => {
    const s = stand();
    return gewaehlt() && s.art === "angeboten" ? s.angebot : undefined;
  };
  return (
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="grid gap-2">
        <Zeilen
          a={props.a}
          stand={stand()}
          waehlen={() => setGewaehlt(true)}
          neu={() => props.neu()}
        />
        <p role="status" class={["text-xs text-muted-foreground", { hidden: !hinweis() }]}>
          {hinweis()}
        </p>
      </div>
      <div class="grid gap-4">
        <Show when={props.fuerKunden}>
          <KundeKarte a={props.a} />
        </Show>
        <Zuletzt a={props.a} />
      </div>
      <UpdateDialog
        i={angebot()}
        onClose={() => setGewaehlt(false)}
        angefordert={() => {
          setGewaehlt(false);
          setHinweis(m.upd_angefordert());
          refresh(angebote);
          props.neu();
        }}
      />
    </div>
  );
};
