import { Menu, type MenuItem, m } from "@steuerzentrale/ui";
import {
  Archive,
  ArchiveRestore,
  FileText,
  type IconNode,
  Lock,
  Settings,
} from "@steuerzentrale/ui/icons";
import { createSignal, Loading, Show } from "solid-js";
import type { Einzelansicht } from "../daten/installationen-laden.ts";
import { GrundDialog, LogDialog } from "./installation-aktionen.tsx";
import { BACKUP, backupsLaden, JetztDialog, PRUEF } from "./installation-backups.tsx";
import { KonfigurierenDialog } from "./installation-konfigurieren.tsx";
import { installationsRecht } from "./recht.tsx";

/*
 * "Mehr …" of an app's page (docs/plan.md, "Navigation (Oberfläche 2026-11)"): the actions beside
 * "Neustart" in a menu, each with its dialog and the rights it had as a button (Z-405, Z-601,
 * Z-602, Z-404): log excerpt for both roles, "nur lesen", "Backup jetzt", "Prüf-Restore jetzt" and
 * "Einstellungen ändern" for the owner (Z-1204), each only where the manifest or the backups offer
 * it. `neu` once a job was made.
 */

export type Wahl = "log" | "backup" | "pruef" | "einstellungen" | "nur_lesen";

/** What decides the entries: the manifest's actions, the role, the backups */
export type MehrStand = {
  aktionen: Einzelansicht["aktionen"];
  recht: boolean;
  backup: boolean;
  pruef: boolean;
};

/** The entries of the menu, in their order, offered as the buttons were before */
export const mehrEintraege = (s: MehrStand): Wahl[] => {
  const alle: [Wahl, boolean][] = [
    // both roles take a log excerpt (Z-1204), only the owner the rest
    ["log", s.aktionen.log_auszug],
    ["backup", s.recht && s.backup],
    ["pruef", s.recht && s.pruef],
    ["einstellungen", s.recht],
    ["nur_lesen", s.recht && s.aktionen.nur_lesen],
  ];
  return alle.filter(([, ja]) => ja).map(([w]) => w);
};

const EINTRAG: Record<Wahl, { label: () => string; icon: IconNode }> = {
  log: { label: m.aktion_log_auszug, icon: FileText },
  backup: { label: m.aktion_backup, icon: Archive },
  pruef: { label: m.aktion_pruef, icon: ArchiveRestore },
  einstellungen: { label: m.inst_konfigurieren, icon: Settings },
  nur_lesen: { label: m.aktion_nur_lesen, icon: Lock },
};

/** The dialog of the entry chosen; `fertig` with what to say once its job was made */
const Dialoge = (props: {
  a: Einzelansicht;
  offen: Wahl | undefined;
  schliessen: () => void;
  fertig: (hinweis: string) => void;
  neu: () => void;
}) => {
  let logAngefordert = false;
  return (
    <>
      <LogDialog
        a={props.a}
        open={props.offen === "log"}
        angefordert={() => {
          logAngefordert = true;
        }}
        onClose={() => {
          props.schliessen();
          if (logAngefordert) props.neu();
          logAngefordert = false;
        }}
      />
      <GrundDialog
        a={props.a}
        aktion="nur_lesen"
        open={props.offen === "nur_lesen"}
        onClose={() => props.schliessen()}
        ausgefuehrt={() => props.fertig("")}
      />
      <JetztDialog
        a={props.a}
        art={BACKUP}
        open={props.offen === "backup"}
        onClose={() => props.schliessen()}
        angefordert={() => props.fertig(BACKUP.angefordert())}
      />
      <JetztDialog
        a={props.a}
        art={PRUEF}
        open={props.offen === "pruef"}
        onClose={() => props.schliessen()}
        angefordert={() => props.fertig(PRUEF.angefordert())}
      />
      <KonfigurierenDialog
        a={props.a}
        open={props.offen === "einstellungen"}
        onClose={() => props.schliessen()}
        konfiguriert={() => props.fertig("")}
      />
    </>
  );
};

export const Mehr = (props: { a: Einzelansicht; neu: () => void }) => {
  const darf = installationsRecht();
  const backups = backupsLaden(() => props.a);
  const [offen, setOffen] = createSignal<Wahl | undefined>();
  const [hinweis, setHinweis] = createSignal("");
  const eintraege = (): MenuItem[] => {
    const b = backups();
    return mehrEintraege({
      aktionen: props.a.aktionen,
      recht: darf(),
      backup: b.ok && BACKUP.angeboten(b.daten),
      pruef: b.ok && PRUEF.angeboten(b.daten),
    }).map((w) => ({
      label: EINTRAG[w].label(),
      icon: EINTRAG[w].icon,
      onSelect: () => setOffen(w),
    }));
  };
  return (
    <Loading fallback={null}>
      <Show when={eintraege().length > 0}>
        <Menu label={m.app_mehr()} trigger={m.app_mehr()} items={eintraege()} />
      </Show>
      <p role="status" class={["basis-full text-xs text-muted-foreground", { hidden: !hinweis() }]}>
        {hinweis()}
      </p>
      <Dialoge
        a={props.a}
        offen={offen()}
        schliessen={() => setOffen(undefined)}
        fertig={(text) => {
          setOffen(undefined);
          setHinweis(text);
          props.neu();
        }}
        neu={() => props.neu()}
      />
    </Loading>
  );
};
