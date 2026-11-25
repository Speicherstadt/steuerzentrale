import { homedir } from "node:os";
import { AGENT_BINARY, pforteGrundkonfiguration } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { type ArchivDeps, archivierenBefehl } from "./abwicklung/archivieren.ts";
import { echtesArchiv } from "./abwicklung/echt.ts";
import type { AgentUpdateDeps } from "./agent-update/aktualisieren.ts";
import { updateBestaetigen } from "./agent-update/marke.ts";
import { PRUEFEN_BEFEHL, type RueckkehrDeps, updatePruefen } from "./agent-update/rueckkehr.ts";
import { echtZeilenLesen } from "./aktionen/journal.ts";
import { auftraegeAnnehmen } from "./auftraege/auftraege.ts";
import { echtSpawn } from "./auftraege/ausfuehren.ts";
import type { Vertrauen } from "./auftraege/pruefen.ts";
import { type SichernBefehlDeps, sichernBefehl } from "./backup/befehl.ts";
import { echtRestic, eigenLesen } from "./backup/echt.ts";
import { backupMelder } from "./backup/melden.ts";
import { beitreten } from "./beitritt/beitreten.ts";
import { type Dateien, echteDateien, echtesBinaer } from "./dateien.ts";
import { dienstPruefen } from "./dienst.ts";
import { echteHausDateien } from "./einrichtung/echt.ts";
import { type Gedaechtnis, gedaechtnisOeffnen } from "./einrichtung/gedaechtnis.ts";
import { type NutzerLesen, nutzerAusPasswd } from "./einrichtung/nutzer.ts";
import { bootIdLesen } from "./fakten/betriebssystem.ts";
import { type FaktenNachricht, faktenLesen } from "./fakten/lesen.ts";
import { echteQuellen } from "./fakten/quellen.ts";
import { type Pfade, pfadeIn } from "./pfade.ts";
import { adminUeberSocket, PFORTE_ADMIN_SOCKET } from "./pforte/admin.ts";
import { type SpielBefehlDeps, spielenBefehl } from "./pruef-restore/spielen.ts";
import { anmeldungenFolgen } from "./ssh/anmeldungen.ts";
import { echtFolgen } from "./ssh/journal.ts";
import { echtOeffnen } from "./verbindung/sockel.ts";
import { type Planer, verbindungsSchleife } from "./verbindung/verbinden.ts";
import { type BeobachtetHalter, beobachtetHalter } from "./zustand/beobachtet.ts";
import { echtLesen, echtVerbinden } from "./zustand/echt.ts";
import { zustandMelder } from "./zustand/runde.ts";

/** What `steuerzentrale-agent --version` prints: its version and the protocol it speaks */
export const versionLine = (): string =>
  `steuerzentrale-agent ${VERSION} (protokoll ${PROTOKOLL_VERSION})`;

/** `bleiben`: the process keeps running after printing (the service) */
export type CliResult = { code: number; out: string; bleiben?: boolean };

export const USAGE = [
  "usage: steuerzentrale-agent --version",
  "       steuerzentrale-agent beitreten --zentrale <url> [--testmodus] < token",
  "       steuerzentrale-agent dienst",
  "       steuerzentrale-agent fakten",
  "       steuerzentrale-agent sichern <installation> [--repository-anlegen]",
  "       steuerzentrale-agent zurueckspielen <installation> < teil.json",
  "       steuerzentrale-agent archivieren <installation> <region>",
  `       steuerzentrale-agent ${PRUEFEN_BEFEHL}`,
].join("\n");

export type CliDeps = {
  dateien: Dateien;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The one-time token, from standard input: an argument would stand in the process list */
  eingabe: () => Promise<string>;
  architektur: string;
  /** Starts the connection to the Zentrale (src/verbindung); the process keeps running for it */
  dienstStarten: (
    zentrale: string,
    pfade: Pfade,
    architektur: "amd64" | "arm64",
    vertrauen: Vertrauen,
    /** Only observed (Z-1102): no job but its own update, and the facts say so */
    nurBeobachten: boolean,
  ) => void;
  /** Reads the server's facts (src/fakten) */
  fakten: () => Promise<FaktenNachricht>;
  /** A backup run as the installation's user (src/backup, Z-601), what its service starts */
  sichern: SichernBefehlDeps;
  /** A part played back as the target installation's user (src/pruef-restore, Z-602) */
  spielen: SpielBefehlDeps;
  archiv: ArchivDeps;
  /** The check after an update of the agent, run by systemd from the old binary (Z-504) */
  rueckkehr: RueckkehrDeps;
  /** Other directories than /etc/steuerzentrale and /var/lib/steuerzentrale, for tests */
  konfig?: string;
  zustand?: string;
};

const planen: Planer = (lauf, ms) => {
  const t = setTimeout(lauf, ms);
  return () => clearTimeout(t);
};

const jsonLog = (msg: string, mehr: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ msg, ...mehr }));

/**
 * The checks of the installations (src/zustand, Z-403) on the record the jobs write, and of the
 * observed services (Z-1103)
 */
const zustandMelden = (
  gedaechtnis: Gedaechtnis,
  nutzer: NutzerLesen,
  beobachtet: BeobachtetHalter,
) =>
  zustandMelder(
    {
      gedaechtnis,
      nutzer,
      beobachtet: beobachtet.lesen,
      spawn: echtSpawn,
      lesen: echtLesen,
      holen: (url, init) => fetch(url, init),
      verbinden: echtVerbinden,
      planen,
      jetzt: Date.now,
    },
    jsonLog,
  );

/** Its own update (Z-504): the binary from its Zentrale, then a restart by systemd */
const agentUpdateDeps = (
  zentrale: string,
  pfade: Pfade,
  architektur: "amd64" | "arm64",
): AgentUpdateDeps => ({
  zentrale,
  architektur,
  binary: AGENT_BINARY,
  marke: pfade.agentUpdate,
  version: VERSION,
  protokoll: PROTOKOLL_VERSION,
  holen: (url, init) => fetch(url, init),
  dateien: echteDateien,
  binaer: echtesBinaer,
  lesen: echtLesen,
  spawn: echtSpawn,
  jetzt: Date.now,
});

const dienstStarten: CliDeps["dienstStarten"] = (
  zentrale,
  pfade,
  architektur,
  vertrauen,
  nurBeobachten,
) => {
  // one record of installations for jobs and checks, so a finished setup is checked at once
  const gedaechtnis = gedaechtnisOeffnen(echteDateien, pfade.installationen, Date.now);
  const nutzer = nutzerAusPasswd(echteHausDateien.lesen);
  // the units the Zentrale names to read, kept only on an observed server (Z-1103)
  const beobachtet = beobachtetHalter(nurBeobachten);
  const auftraege = auftraegeAnnehmen({
    dateien: echteDateien,
    pfad: pfade.auftraege,
    vertrauen,
    nurBeobachten,
    spawn: echtSpawn,
    // 80 and 443, certificates by ACME (docs/plan.md, "Pforte")
    pforte: {
      admin: adminUeberSocket((url, init) => fetch(url, init), PFORTE_ADMIN_SOCKET),
      grund: pforteGrundkonfiguration(),
    },
    installationen: {
      pfad: pfade.installationen,
      gedaechtnis,
      haus: echteHausDateien,
      nutzer,
      lesen: echtLesen,
      journal: echtZeilenLesen,
      warten: (ms) => Bun.sleep(ms),
      holen: (url, init) => fetch(url, init),
      verbinden: echtVerbinden,
    },
    planen,
    jetzt: Date.now,
    log: jsonLog,
    agentUpdate: agentUpdateDeps(zentrale, pfade, architektur),
    // the result is kept and sent; systemd (Restart=always) starts the new binary
    neustarten: () => planen(() => process.exit(0), 2000),
    // the reboot of the server (Z-701): `systemctl reboot` as root, the agent's own user
    neustart: {
      bootId: () => bootIdLesen(echteQuellen()),
      spawn: echtSpawn,
      warten: (ms) => Bun.sleep(ms),
    },
  });
  // a copy of a Prüf-Restore (Z-602) or a restore (Z-603) the agent did not finish before it stopped
  void auftraege.aufraeumen();
  verbindungsSchleife(
    {
      oeffnen: echtOeffnen,
      planen,
      jetzt: Date.now,
      zufall: Math.random,
      log: (zeile) => console.log(zeile),
      dateien: echteDateien,
      pfade,
      architektur,
      meldungen: {
        fakten: async (uhrzeitAbweichungMs) => ({
          ...(await faktenLesen(echteQuellen(), { jetzt: Date.now(), uhrzeitAbweichungMs })),
          ...(nurBeobachten ? { nurBeobachten } : {}),
        }),
        anmeldungen: (melden) =>
          anmeldungenFolgen({
            folgen: echtFolgen,
            dateien: echteDateien,
            cursorPfad: pfade.sshCursor,
            melden,
          }),
        zustand: zustandMelden(gedaechtnis, nutzer, beobachtet),
        backups: backupMelder({
          gedaechtnis,
          nutzer,
          lesen: echtLesen,
          dateien: echteDateien,
          pfad: pfade.backupGemeldet,
          log: jsonLog,
        }),
      },
      auftraege,
      beobachten: beobachtet.setzen,
      verbunden: () =>
        updateBestaetigen({
          dateien: echteDateien,
          binaer: echtesBinaer,
          pfad: pfade.agentUpdate,
          version: VERSION,
          log: jsonLog,
        }),
    },
    zentrale,
  );
};

const echteDeps = (): CliDeps => ({
  dateien: echteDateien,
  fetch: (url, init) => fetch(url, init),
  eingabe: () => Bun.stdin.text(),
  architektur: process.arch,
  dienstStarten,
  fakten: () => faktenLesen(echteQuellen(), { jetzt: Date.now(), uhrzeitAbweichungMs: null }),
  sichern: {
    uid: () => process.getuid?.() ?? 0,
    home: homedir,
    dateien: echteDateien,
    sichern: { restic: echtRestic(), jetzt: Date.now, id: () => crypto.randomUUID(), planen },
  },
  archiv: echtesArchiv(),
  spielen: {
    uid: () => process.getuid?.() ?? 0,
    eingabe: () => Bun.stdin.text(),
    restic: echtRestic(),
    lesen: eigenLesen,
  },
  rueckkehr: {
    dateien: echteDateien,
    binaer: echtesBinaer,
    binary: AGENT_BINARY,
    marke: pfadeIn().agentUpdate,
    spawn: echtSpawn,
    uid: () => process.getuid?.() ?? 0,
  },
});

/** `--name wert` pairs and bare `--flag`s; anything else makes the arguments invalid */
const optionen = (args: string[], mitWert: string[]): Map<string, string> | undefined => {
  const gelesen = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const name = args[i] ?? "";
    if (!name.startsWith("--")) return undefined;
    if (!mitWert.includes(name)) gelesen.set(name, "");
    else if (args[i + 1] === undefined) return undefined;
    else gelesen.set(name, args[++i] ?? "");
  }
  return gelesen;
};

const ARCHITEKTUREN: Record<string, "amd64" | "arm64"> = { x64: "amd64", arm64: "arm64" };

const beitretenBefehl = async (deps: CliDeps, args: string[]): Promise<CliResult> => {
  const o = optionen(args, ["--zentrale"]);
  const zentrale = o?.get("--zentrale");
  const architektur = ARCHITEKTUREN[deps.architektur];
  if (!o || !zentrale || [...o.keys()].some((k) => k !== "--zentrale" && k !== "--testmodus"))
    return { code: 2, out: USAGE };
  if (!architektur) return { code: 1, out: `unsupported architecture ${deps.architektur}` };
  const token = (await deps.eingabe()).trim();
  const ergebnis = await beitreten(
    { ...deps, pfade: pfadeIn(deps.konfig, deps.zustand), architektur },
    { zentrale, token, testmodus: o.has("--testmodus") },
  );
  return ergebnis.ok
    ? { code: 0, out: JSON.stringify({ msg: "joined", serverId: ergebnis.wert }) }
    : { code: 1, out: JSON.stringify({ msg: "join failed", grund: ergebnis.grund }) };
};

const dienstBefehl = async (deps: CliDeps): Promise<CliResult> => {
  const pfade = pfadeIn(deps.konfig, deps.zustand);
  const architektur = ARCHITEKTUREN[deps.architektur];
  if (!architektur) return { code: 1, out: `unsupported architecture ${deps.architektur}` };
  const geprueft = await dienstPruefen(deps.dateien, pfade);
  if (!geprueft.ok)
    return { code: 1, out: JSON.stringify({ msg: "refusing to start", grund: geprueft.grund }) };
  const { zentrale, serverId, vertrauen, nurBeobachten } = geprueft.wert;
  deps.dienstStarten(zentrale, pfade, architektur, vertrauen, nurBeobachten);
  return {
    code: 0,
    bleiben: true,
    out: JSON.stringify({ msg: "ready", version: VERSION, zentrale, serverId, nurBeobachten }),
  };
};

/** Runs the command line */
export const runCli = async (args: string[], deps: CliDeps = echteDeps()): Promise<CliResult> => {
  if (args.includes("--version")) return { code: 0, out: versionLine() };
  const [befehl, ...rest] = args;
  if (befehl === "beitreten") return beitretenBefehl(deps, rest);
  if (befehl === "dienst" && rest.length === 0) return dienstBefehl(deps);
  // what the agent would report, for a look on the server; the clock needs the Zentrale
  if (befehl === "fakten" && rest.length === 0)
    return { code: 0, out: JSON.stringify(await deps.fakten(), null, 2) };
  // the backup's service as the installation's user, without the Zentrale (docs/plan.md, Z-601)
  if (befehl === "sichern") return sichernBefehl(rest, deps.sichern);
  // a part of a backup played back as the target's user, started by the agent (Z-602)
  if (befehl === "zurueckspielen") return spielenBefehl(rest, deps.spielen);
  // the archive for the customer after the contract, as the installation's user (Z-604)
  if (befehl === "archivieren") return archivierenBefehl(rest, deps.archiv);
  // the check after its own update, run by systemd from the old binary (Z-504)
  if (befehl === PRUEFEN_BEFEHL && rest.length === 0) return updatePruefen(deps.rueckkehr);
  return { code: 2, out: USAGE };
};
