import { closeSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pforteGrundkonfiguration, schluesselLesen } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { geheimenSchluesselLesen, signieren } from "../../../scripts/minisign.ts";
import { auftraegeAnnehmen } from "../src/auftraege/auftraege.ts";
import { eingabeRohr, type Spawn } from "../src/auftraege/ausfuehren.ts";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { speicher, TEST_PUB } from "../src/beitritt/testhilfen.ts";
import { gedaechtnisOeffnen } from "../src/einrichtung/gedaechtnis.ts";
import type { HausDateien } from "../src/einrichtung/haus.ts";
import { nutzerAusPasswd, PATH } from "../src/einrichtung/nutzer.ts";
import { testCaddy } from "../src/pforte/testcaddy.ts";
import type { Planer } from "../src/verbindung/verbinden.ts";
import { echtVerbinden } from "../src/zustand/echt.ts";
import type { SpawnMitAusgabe } from "../src/zustand/pruefen.ts";
import { type ZustandNachricht, zustandLesen } from "../src/zustand/runde.ts";
import { lauf } from "./pforte-hilfen.ts";

/*
 * Helpers of the setup tests with real Podman and systemd (CI only): the agent's job handling with
 * root's part done through `sudo -n` (the runner is not root; in CI sudo is allowed), so that
 * useradd, loginctl, runuser and writing into a user's home are the real ones. ci.yml sets
 * SZ_TEST_EINRICHTUNG=1 once the Pforte's user and the test registry are ready; without it the
 * tests would make Linux users on a developer's machine, so they run only then.
 */

export const EINRICHTUNG_BEREIT = process.env.SZ_TEST_EINRICHTUNG === "1";

/**
 * Root's argv through sudo; what failed is printed with its error output, never its input. The
 * output is read while it runs and not waited for after the end: a child that outlives a killed
 * sudo keeps the pipe open
 */
export const sudoSpawn: Spawn = async (argv, signal, o = {}) => {
  const rohr = o.eingabe === undefined ? undefined : eingabeRohr(o.eingabe);
  const p = Bun.spawn(["sudo", "-n", ...argv], {
    stdin: rohr ?? "ignore",
    stdout: "ignore",
    stderr: "pipe",
    cwd: "/",
    signal,
    killSignal: "SIGKILL",
    env: { PATH, LC_ALL: "C" },
  });
  if (rohr !== undefined) closeSync(rohr);
  let fehler = "";
  const text = new TextDecoder();
  const lesen = (async () => {
    for await (const stueck of p.stderr) fehler += text.decode(stueck, { stream: true });
  })().catch(() => {});
  const code = (await p.exited) ?? null;
  await Promise.race([lesen, Bun.sleep(500)]);
  if (code !== 0) console.warn(`${argv.join(" ")} ended with ${code}\n${fehler.slice(-4000)}`);
  return { code };
};

/** Root's argv through sudo with its standard output, as the checks read `systemctl show` (Z-403) */
export const sudoLesen: SpawnMitAusgabe = async (argv, signal) => {
  const p = Bun.spawn(["sudo", "-n", ...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    cwd: "/",
    signal,
    killSignal: "SIGKILL",
    env: { PATH, LC_ALL: "C" },
  });
  const aus = await new Response(p.stdout).text();
  return { code: (await p.exited) ?? null, aus };
};

const sudo = (...argv: string[]) => lauf(["sudo", "-n", ...argv]);
const muss = (...argv: string[]) => {
  const l = sudo(...argv);
  if (l.code !== 0) throw new Error(`sudo ${argv.join(" ")} ended with ${l.code}: ${l.fehler}`);
};
const oktal = (modus: number) => modus.toString(8).padStart(4, "0");

/** Root's file system through sudo; `besitzer` records who got which path, for the checks */
export const sudoHaus = (ordner: string, besitzer = new Map<string, number>()): HausDateien => ({
  lesen: async (pfad) => {
    const l = sudo("cat", "--", pfad);
    return l.code === 0 ? l.aus : undefined;
  },
  dateiLesen: async (pfad) => {
    if (sudo("test", "-L", pfad).code === 0) throw new Error(`${pfad} is a symlink`);
    if (sudo("test", "-e", pfad).code !== 0) return undefined;
    if (sudo("test", "-f", pfad).code !== 0) throw new Error(`${pfad} is not a regular file`);
    const l = sudo("cat", "--", pfad);
    if (l.code !== 0) throw new Error(`${pfad} cannot be read`);
    return l.aus;
  },
  existiert: async (pfad) => sudo("test", "-e", pfad).code === 0,
  verzeichnis: async (pfad, modus, { uid, gid }) => {
    besitzer.set(pfad, uid);
    muss("mkdir", "-p", "--", pfad);
    muss("chmod", oktal(modus), "--", pfad);
    muss("chown", `${uid}:${gid}`, "--", pfad);
  },
  schreiben: async (pfad, inhalt, modus, { uid, gid }) => {
    besitzer.set(pfad, uid);
    const tmp = join(mkdtempSync(join(ordner, "datei-")), "inhalt");
    writeFileSync(tmp, inhalt, { mode: 0o600 });
    try {
      muss("install", "-m", oktal(modus), "-o", String(uid), "-g", String(gid), "--", tmp, pfad);
    } finally {
      rmSync(tmp, { force: true });
    }
  },
});

export const nutzerLesen = nutzerAusPasswd(async (pfad) => {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return undefined;
  }
});

const TEST_KEY = () =>
  geheimenSchluesselLesen(
    readFileSync(join(import.meta.dirname, "../../../test/schluessel/test.key"), "utf8"),
  );

export const signiert = (text: string): string =>
  signieren(new TextEncoder().encode(text), TEST_KEY(), "test manifest (test key)");

/** Replaces text that must be there: a changed template fails the test instead of passing it */
export const ersetzen = (text: string, alt: string, neu: string): string => {
  if (!text.includes(alt)) throw new Error(`not in the manifest: ${alt}`);
  return text.replace(alt, neu);
};

export type EchterAgent = ReturnType<typeof echterAgent>;

/** The agent's job handling as on a server; records in memory, root's part through sudo */
export const echterAgent = () => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-einrichtung-"));
  const besitzer = new Map<string, number>();
  const gesendet: Record<string, unknown>[] = [];
  const fs = speicher();
  const planen: Planer = (los, ms) => {
    const t = setTimeout(los, ms);
    return () => clearTimeout(t);
  };
  // one record for jobs and checks, as the service has (cli.ts)
  const gedaechtnis = gedaechtnisOeffnen(fs.dateien, "/z/installationen.json", Date.now);
  const a = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: "/z/auftraege.json",
    vertrauen: { schluessel, zweck: "test" },
    spawn: sudoSpawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    installationen: {
      pfad: "/z/installationen.json",
      gedaechtnis,
      haus: sudoHaus(ordner, besitzer),
      nutzer: nutzerLesen,
      lesen: sudoLesen,
      warten: (ms) => Bun.sleep(ms),
    },
    planen,
    jetzt: Date.now,
    log: () => {},
  });
  /** One round of the checks (Z-403) with the real fetch and socket, root's part through sudo */
  const zustand = async (): Promise<ZustandNachricht> => {
    const r = await zustandLesen({
      gedaechtnis,
      nutzer: nutzerLesen,
      spawn: sudoSpawn,
      lesen: sudoLesen,
      holen: (url, init) => fetch(url, init),
      verbinden: echtVerbinden,
      planen,
      jetzt: Date.now,
    });
    if (!r.ok) throw new Error(r.grund);
    return r.nachricht;
  };
  const auftrag = async (n: Omit<AuftragNachricht, "typ" | "protokoll">) => {
    await a.empfangen({ typ: "auftrag", protokoll: PROTOKOLL_VERSION, ...n }, (t) =>
      gesendet.push(JSON.parse(t)),
    );
    return (gesendet.at(-1) as { ergebnis?: unknown } | undefined)?.ergebnis;
  };
  const record = () =>
    JSON.parse(fs.inhalt.get("/z/installationen.json")?.text ?? '{"installationen":{}}')
      .installationen as Record<string, unknown>;
  const aufraeumen = () => rmSync(ordner, { recursive: true, force: true });
  return { auftrag, record, besitzer, aufraeumen, zustand };
};

/** Takes an installation off the runner, whatever state it is in; for afterAll */
export const wegraeumen = (installation: string): void => {
  const nutzer = `sz-${installation}`;
  sudo("loginctl", "disable-linger", nutzer);
  sudo("loginctl", "terminate-user", nutzer);
  for (let i = 0; i < 30 && lauf(["id", "-u", nutzer]).code === 0; i++) {
    sudo("userdel", "--remove", nutzer);
    Bun.sleepSync(1000);
  }
  sudo("rm", "-rf", "--one-file-system", "--", `/home/${nutzer}`);
};
