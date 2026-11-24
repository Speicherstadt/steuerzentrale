import { Button, Icon, m } from "@steuerzentrale/ui";
import {
  CircleArrowUp,
  CircleCheck,
  Clock,
  type IconNode,
  LoaderCircle,
  TriangleAlert,
} from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, Match, refresh, Show, Switch } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { appsQuelle, type InstallationsAngebot } from "../daten/apps.ts";
import { bestand } from "../daten/quelle.ts";
import {
  type AppGruppe,
  type Gruppe,
  type GruppenKopf,
  type UpdateZeile,
  updateTabelle,
  type ZeilenStand,
} from "../daten/update-tabelle.ts";
import { planText, updateText } from "../daten/update-texte.ts";
import type { Welle } from "../daten/wellen.ts";
import { isoTag, uhrzeit, zeitpunkt } from "../format/zeit.ts";
import { Tabelle } from "../teile/tabelle.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { Zustand } from "../teile/zeichen.tsx";
import { Fehler } from "./anmeldung-teile.tsx";
import { ManifestImportieren } from "./app-versionen.tsx";
import { installationsRecht, MitInstallationsRecht } from "./recht.tsx";
import { UpdateDialog } from "./update-dialog.tsx";

/*
 * The table of the page "Updates" (BAULISTE.md Z-501, Z-503): per app its head, the installations
 * in a running wave or able to update with their state, the current ones counted, a registry tag
 * without manifest with its import; an update by hand for owner and technik (update-dialog.tsx).
 */

const ZEILE =
  "border-b align-middle transition-colors hover:bg-muted [&>td]:p-2 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4";
const KOPFZEILE = "border-b bg-muted [&>td]:p-2 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4";

const SCHRITT: Record<Welle, () => string> = {
  intern: () => m.upd_schritt_intern(),
  alle: () => m.upd_schritt_alle(),
};

/** "heute 22:00", "morgen 02:00" or a date */
const wann = (ab: number, jetzt: number) =>
  isoTag(ab) === isoTag(jetzt) ? m.zeit_heute({ zeit: uhrzeit(ab) }) : zeitpunkt(ab, jetzt);

type Zeichen = { icon: IconNode; farbe: string; text: string; titel?: string | undefined };

const standZeichen = (s: ZeilenStand, a: InstallationsAngebot | null): Zeichen => {
  const jetzt = bestand().jetzt;
  const letztes = a ? updateText(a.update, jetzt) : undefined;
  switch (s.art) {
    case "welle": {
      const schritt = SCHRITT[s.welle]();
      if (s.zustand === "fertig")
        return { icon: CircleCheck, farbe: "text-ok", text: m.upd_stand_fertig({ schritt }) };
      if (s.zustand === "laeuft")
        return { icon: LoaderCircle, farbe: "text-primary", text: m.upd_stand_laeuft({ schritt }) };
      return {
        icon: Clock,
        farbe: "text-muted-foreground",
        text:
          s.ab === null
            ? m.upd_stand_wartet_ohne({ schritt })
            : m.upd_stand_wartet({ schritt, zeit: wann(s.ab, jetzt) }),
      };
    }
    case "laeuft":
      return { icon: LoaderCircle, farbe: "text-primary", text: letztes ?? "" };
    case "misslungen":
      return { icon: TriangleAlert, farbe: "text-warn", text: letztes ?? "" };
    case "verfuegbar":
      return {
        icon: CircleArrowUp,
        farbe: "text-primary",
        text: m.upd_stand_verfuegbar(),
        titel: a ? `${planText(a.plan, jetzt)} · ${letztes}` : undefined,
      };
  }
};

const kopfZeichen = (k: GruppenKopf): Zeichen => {
  switch (k.art) {
    case "welle":
      return {
        icon: LoaderCircle,
        farbe: "text-primary",
        text: m.upd_kopf_welle({ fertig: k.fertig, gesamt: k.gesamt }),
      };
    case "von_hand":
      return { icon: TriangleAlert, farbe: "text-warn", text: m.upd_kopf_von_hand() };
    case "koennen":
      return {
        icon: CircleArrowUp,
        farbe: "text-primary",
        text: m.upd_kopf_koennen({ n: k.n, gesamt: k.gesamt }),
      };
    case "aktuell":
      return { icon: CircleCheck, farbe: "text-ok", text: m.upd_kopf_aktuell({ n: k.n }) };
  }
};

const Zeichen = (props: { z: Zeichen }) => (
  <Zustand icon={props.z.icon} farbe={props.z.farbe} text={props.z.text} titel={props.z.titel} />
);

const Kopf = (props: { name: string; version: string | null; kopf: GruppenKopf | null }) => (
  <tr class={KOPFZEILE}>
    <td class="font-semibold">{props.name}</td>
    <td />
    <td class="font-mono text-xs font-semibold">{props.version}</td>
    <td>
      <Show when={props.kopf}>{(k) => <Zeichen z={kopfZeichen(k())} />}</Show>
    </td>
    <td />
  </tr>
);

const Zeile = (props: {
  z: UpdateZeile;
  darf: boolean;
  waehlen: (i: InstallationsAngebot) => void;
}) => (
  <tr class={ZEILE}>
    <td>
      <Show when={props.z.kunde}>
        <span class="font-medium">
          {props.z.kunde}
          {props.z.gekuendigt ? ` · ${m.upd_gekuendigt()}` : ""}
        </span>{" "}
      </Show>
      <ZuInstallation id={props.z.installationId} class="font-mono text-xs text-muted-foreground">
        {props.z.installationId}
      </ZuInstallation>
    </td>
    <td class="font-mono text-xs text-muted-foreground">{props.z.installiert}</td>
    <td class="font-mono text-xs">{props.z.neu}</td>
    <td>
      <Zeichen z={standZeichen(props.z.stand, props.z.angebot)} />
    </td>
    <td class="text-right">
      <Show
        when={
          props.darf &&
          props.z.angebot &&
          props.z.angebot.angeboten.length > 0 &&
          !props.z.angebot.update.laeuft
            ? props.z.angebot
            : undefined
        }
      >
        {(a) => (
          <Button
            size="sm"
            aria-label={m.upd_knopf_installation({ name: props.z.installationId })}
            onClick={() => props.waehlen(a())}
          >
            {m.upd_knopf()}
          </Button>
        )}
      </Show>
    </td>
  </tr>
);

const ManifestFehlt = (props: { name: string; version: string; neu: () => void }) => (
  <tr class={ZEILE}>
    <td colspan="4">
      <span class="inline-flex items-center gap-1.5 text-xs">
        <Icon icon={TriangleAlert} size={14} class="text-warn" />
        <span>
          <b>
            {props.name} {props.version}
          </b>{" "}
          {m.upd_manifest_fehlt()}
        </span>
      </span>
    </td>
    <td class="text-right">
      <MitInstallationsRecht>
        <ManifestImportieren klein onImportiert={() => props.neu()} />
      </MitInstallationsRecht>
    </td>
  </tr>
);

const AppGruppeZeilen = (props: {
  g: AppGruppe;
  darf: boolean;
  waehlen: (i: InstallationsAngebot) => void;
  neu: () => void;
}) => (
  <>
    <Kopf name={props.g.name} version={props.g.neueste} kopf={props.g.kopf} />
    <For each={props.g.zeilen}>
      {(z) => <Zeile z={z} darf={props.darf} waehlen={props.waehlen} />}
    </For>
    <Show when={props.g.weitere && props.g.weitere.n > 0 ? props.g.weitere : undefined}>
      {(w) => (
        <tr class={ZEILE}>
          <td colspan="5" class="text-xs text-muted-foreground">
            {m.upd_weitere({ n: w().n, version: w().version })}
          </td>
        </tr>
      )}
    </Show>
    <Show when={props.g.manifestFehlt}>
      {(v) => <ManifestFehlt name={props.g.name} version={v()} neu={props.neu} />}
    </Show>
  </>
);

const GruppeZeilen = (props: {
  g: Gruppe;
  darf: boolean;
  waehlen: (i: InstallationsAngebot) => void;
  neu: () => void;
}) => (
  <Switch>
    <Match when={props.g.art === "app" ? props.g : undefined}>
      {(g) => <AppGruppeZeilen g={g()} darf={props.darf} waehlen={props.waehlen} neu={props.neu} />}
    </Match>
    <Match when={props.g.art === "aktuell" ? props.g : undefined}>
      {(g) => (
        <Kopf name={g().namen.join(" · ")} version={null} kopf={{ art: "aktuell", n: g().n }} />
      )}
    </Match>
  </Switch>
);

const daten = <T,>(a: Antwort<T[]>): T[] => (a.ok ? a.daten : []);

/**
 * The table with its groups, read anew once an update is asked for or a manifest imported
 */
export const UpdateTabelle = () => {
  const angebote = createMemo(() => appsQuelle().angebote());
  const apps = createMemo(() => appsQuelle().liste());
  const darf = installationsRecht();
  const [gewaehlt, setGewaehlt] = createSignal<InstallationsAngebot | undefined>();
  const [hinweis, setHinweis] = createSignal("");
  const gruppen = () => updateTabelle(bestand(), daten(angebote()), daten(apps()));
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
      <Show when={!angebote().ok || !apps().ok}>
        <Fehler text={m.apps_versionen_fehler()} />
      </Show>
      <div class="min-w-0 rounded-xl border bg-background">
        <Tabelle
          name={m.nav_updates()}
          rahmen={false}
          spalten={[
            { name: m.upd_spalte_app_installation() },
            { name: m.upd_spalte_installiert() },
            { name: m.upd_spalte_neu() },
            { name: m.upd_spalte_stand() },
            { name: m.upd_spalte_aktion(), class: "text-right" },
          ]}
          minBreite={860}
          leer={m.upd_keine_installationen()}
          anzahl={gruppen().length}
        >
          <For each={gruppen()}>
            {(g) => (
              <GruppeZeilen
                g={g}
                darf={darf()}
                waehlen={(x) => setGewaehlt(x)}
                neu={() => refresh(apps)}
              />
            )}
          </For>
        </Tabelle>
      </div>
      <p role="status" class={["text-xs text-muted-foreground", { hidden: !hinweis() }]}>
        {hinweis()}
      </p>
      <UpdateDialog
        i={gewaehlt()}
        onClose={() => setGewaehlt(undefined)}
        angefordert={() => {
          setGewaehlt(undefined);
          setHinweis(m.upd_angefordert());
          refresh(angebote);
        }}
      />
    </Loading>
  );
};
