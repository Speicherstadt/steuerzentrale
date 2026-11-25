import { Button, Dialog, Icon, m } from "@steuerzentrale/ui";
import { LoaderCircle, Lock, RotateCw } from "@steuerzentrale/ui/icons";
import { createSignal, onSettled, Show } from "solid-js";
import type { Fehlschlag } from "../anmeldung/api.ts";
import {
  type InstallationAnsicht,
  linuxNutzerVon,
  titelVon,
} from "../daten/installation-ansicht.ts";
import {
  type InstallationsAktion,
  installationenQuelle,
  type LogAuszug,
} from "../daten/installationen.ts";
import { Fehler } from "./anmeldung-teile.tsx";
import { installationsFehler } from "./installieren-texte.ts";

/*
 * The actions of an installation (BAULISTE.md Z-405; mockup, installation page and "Log-Auszug";
 * docs/plan.md, "Aktionen einer Installation"): only the actions its manifest offers, each with a
 * reason for the audit log. Both roles restart and take a log excerpt, only the owner "nur lesen" (Z-1204). A log
 * excerpt is a job: the dialog asks the Zentrale every second for its lines until
 * the agent sent them, and shows them. The head of an app's page offers them (app-kopf.tsx,
 * app-mehr.tsx), which decides who sees which.
 */

export type Angaben = InstallationAnsicht & { aktionen: Record<InstallationsAktion, boolean> };

/** How often and how far apart the dialog asks for the lines before it gives up waiting */
const VERSUCHE = 120;
const ABSTAND_MS = 1000;

const AKTIONS_FEHLER: Record<string, () => string> = {
  laeuft_nicht: m.aktion_fehler_laeuft_nicht,
  sperrzeit: m.aktion_fehler_sperrzeit,
  nicht_angeboten: m.aktion_fehler_nicht_angeboten,
  nicht_ausfuehrbar: m.aktion_fehler_nicht_ausfuehrbar,
};

/** The error of an action as one sentence; codes shared with installing keep their text */
const aktionsFehler = (f: Pick<Fehlschlag, "fehler" | "detail">): string => {
  const eigen = AKTIONS_FEHLER[f.fehler];
  if (!eigen) return installationsFehler(f);
  return f.detail ? m.inst_fehler_mit_detail({ text: eigen(), detail: f.detail }) : eigen();
};

export type Schreibend = Exclude<InstallationsAktion, "log_auszug">;

export const TITEL: Record<Schreibend, () => string> = {
  neustart: m.aktion_neustart,
  nur_lesen: m.aktion_nur_lesen,
};

const TEXT: Record<Schreibend, (w: { name: string }) => string> = {
  neustart: m.aktion_neustart_text,
  nur_lesen: m.aktion_nur_lesen_text,
};

/** Restart or "nur lesen": a reason, then the job; `ausgefuehrt` once the Zentrale made it */
export const GrundDialog = (props: {
  a: Angaben;
  aktion: Schreibend;
  open: boolean;
  onClose: () => void;
  ausgefuehrt: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    event.preventDefault();
    setLaeuft(true);
    const antwort = await installationenQuelle().aktion(props.a.id, props.aktion);
    setLaeuft(false);
    if (!antwort.ok) return setFehler(aktionsFehler(antwort));
    setFehler("");
    props.ausgefuehrt();
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={TITEL[props.aktion]()}
      description={TEXT[props.aktion]({ name: titelVon(props.a) })}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="primary" disabled={laeuft()}>
              {m.aktion_ausfuehren()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

const warten = (ms: number) => new Promise((fertig) => setTimeout(fertig, ms));

/** The lines once they arrived, or why there are none */
const Zeilen = (props: { auszug: LogAuszug }) => (
  <Show
    when={props.auszug.zeilen}
    fallback={<Fehler text={m.log_auszug_gescheitert({ fehler: props.auszug.fehler ?? "–" })} />}
  >
    {(zeilen) => (
      <div class="grid gap-2">
        <p class="text-xs text-muted-foreground">
          {m.log_auszug_anzahl({ anzahl: String(zeilen().length) })}
        </p>
        <Show
          when={zeilen().length > 0}
          fallback={<p class="text-sm text-muted-foreground">{m.log_auszug_leer()}</p>}
        >
          <section
            aria-label={m.log_auszug_zeilen()}
            tabindex="0"
            data-testid="log-zeilen"
            class="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-4"
          >
            <pre class="font-mono text-xs leading-relaxed">{zeilen().join("\n")}</pre>
          </section>
        </Show>
      </div>
    )}
  </Show>
);

/**
 * The inside of the log dialog, made anew each time it opens: a reason, then the lines; asking
 * stops when the dialog closes
 */
const LogInhalt = (props: { a: Angaben; onClose: () => void; angefordert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const [auftrag, setAuftrag] = createSignal<string>();
  const [auszug, setAuszug] = createSignal<LogAuszug>();
  const [still, setStill] = createSignal(false);
  let offen = true;
  onSettled(() => () => {
    offen = false;
  });

  const holen = async (id: string, auftragId: string) => {
    for (let n = 0; n < VERSUCHE && offen; n++) {
      const r = await installationenQuelle().logAuszug(id, auftragId);
      if (!offen) return;
      if (!r.ok) return setFehler(aktionsFehler(r));
      const fertig =
        r.daten.zeilen !== null || ["gescheitert", "abgebrochen"].includes(r.daten.zustand);
      if (fertig) return setAuszug(r.daten);
      await warten(ABSTAND_MS);
    }
    if (offen) setStill(true);
  };

  const senden = async (event: SubmitEvent) => {
    event.preventDefault();
    setLaeuft(true);
    const id = props.a.id;
    const antwort = await installationenQuelle().aktion(id, "log_auszug");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(aktionsFehler(antwort));
    setFehler("");
    setAuftrag(antwort.daten.auftragId);
    props.angefordert();
    await holen(id, antwort.daten.auftragId);
  };

  return (
    <div class="grid gap-4">
      <Show
        when={auftrag()}
        fallback={<form id="log-auszug-form" class="grid gap-4" onSubmit={senden}></form>}
      >
        <Show
          when={auszug()}
          fallback={
            <p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
              <Show when={!still()} fallback={m.log_auszug_still()}>
                <Icon icon={LoaderCircle} class="animate-spin" />
                {m.log_auszug_wartet()}
              </Show>
            </p>
          }
        >
          {(a) => <Zeilen auszug={a()} />}
        </Show>
      </Show>
      <Fehler text={fehler()} />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => props.onClose()}>{m.knopf_schliessen()}</Button>
        <Show when={!auftrag()}>
          <Button type="submit" form="log-auszug-form" variant="primary" disabled={laeuft()}>
            {m.log_auszug_anfordern()}
          </Button>
        </Show>
      </div>
    </div>
  );
};

export const LogDialog = (props: {
  a: Angaben;
  open: boolean;
  onClose: () => void;
  angefordert: () => void;
}) => (
  <Dialog
    open={props.open}
    onClose={() => props.onClose()}
    title={m.aktion_log_auszug()}
    description={m.log_auszug_text({ name: titelVon(props.a), nutzer: linuxNutzerVon(props.a) })}
  >
    <Show when={props.open}>
      <LogInhalt
        a={props.a}
        onClose={() => props.onClose()}
        angefordert={() => props.angefordert()}
      />
    </Show>
  </Dialog>
);

const ICON = { neustart: RotateCw, nur_lesen: Lock } as const;

/** A button for restart or "nur lesen" with its dialog */
export const SchreibendeAktion = (props: { a: Angaben; aktion: Schreibend; neu: () => void }) => {
  const [offen, setOffen] = createSignal(false);
  return (
    <Show when={props.a.aktionen[props.aktion]}>
      <Button onClick={() => setOffen(true)}>
        <Icon icon={ICON[props.aktion]} />
        {TITEL[props.aktion]()}
      </Button>
      <GrundDialog
        a={props.a}
        aktion={props.aktion}
        open={offen()}
        onClose={() => setOffen(false)}
        ausgefuehrt={() => {
          setOffen(false);
          props.neu();
        }}
      />
    </Show>
  );
};
