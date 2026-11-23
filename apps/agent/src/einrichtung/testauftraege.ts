import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
  pforteGrundkonfiguration,
  schluesselLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { type AuftraegeDeps, auftraegeAnnehmen } from "../auftraege/auftraege.ts";
import type { AuftragNachricht } from "../auftraege/pruefen.ts";
import { speicher, TEST_PUB } from "../beitritt/testhilfen.ts";
import { testCaddy } from "../pforte/testcaddy.ts";
import { PFORTE, type TestSystem, type TestSystemOptionen, testSystem } from "./testsystem.ts";

/*
 * The setup jobs of the unit tests (Z-402): packages/manifest/test/einrichtung.yml, the example
 * app's manifest with a made-up digest, a secret and a file, signed with the public test key; and
 * the agent's job handling on the server in memory (testsystem.ts).
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
export const MANIFEST = readFileSync(join(FIXTURES, "einrichtung.yml"), "utf8");
export const SIGNATUR = readFileSync(join(FIXTURES, "einrichtung.yml.minisig"), "utf8");

export const AUFTRAEGE = "/z/auftraege.json";
export const INSTALLATIONEN = "/z/installationen.json";
export const NAME = "beispiel-x7k2p9";
export const NUTZER = `sz-${NAME}`;
export const HOME = `/home/${NUTZER}`;
export const GEHEIM = "streng-geheim-0815";
export const IMAGE = `localhost:5000/beispiel@sha256:${"a".repeat(64)}`;

export const EINRICHTUNG: Einrichtung = {
  installation: {
    kundeId: "k-1",
    optionen: [],
    httpPort: 20001,
    ports: { "app:9000": 20002 },
    host: "beispiel.kunde.example",
    ipv4: null,
  },
  einstellungen: { betreiber: {}, installation: {}, auto: { BEISPIEL_SCHLUESSEL: GEHEIM } },
};

export const einrichtenAuftrag = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht => ({
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "e1",
  installationId: NAME,
  aktion: EINRICHTUNG_AKTIONEN.einrichten,
  argumente: {},
  manifest: MANIFEST,
  signatur: SIGNATUR,
  zeitlimitS: 1800,
  einrichtung: EINRICHTUNG,
  ...teil,
});

export const entfernenAuftrag = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "r1",
    aktion: EINRICHTUNG_AKTIONEN.entfernen,
    einrichtung: undefined,
    ...teil,
  });

export const konfigurierenAuftrag = (
  einrichtung: Einrichtung,
  teil: Partial<AuftragNachricht> = {},
): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "k1",
    aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
    einrichtung,
    ...teil,
  });

/** The record of installations with these as set up by the agent */
export const eingerichtet = (
  namen: Record<string, "angelegt" | "fertig">,
): Record<string, string> => ({
  [INSTALLATIONEN]: JSON.stringify({
    installationen: Object.fromEntries(
      Object.entries(namen).map(([n, zustand]) => [n, { zustand, am: 0 }]),
    ),
  }),
});

/** What the job handling needs of the installations, on a server in memory */
export const installationenAuf = (sys: TestSystem): AuftraegeDeps["installationen"] => ({
  pfad: INSTALLATIONEN,
  haus: sys.haus,
  nutzer: sys.nutzerLesen,
  lesen: sys.lesen,
  journal: sys.zeilenLesen,
  warten: async () => {},
  // the copy of a Prüf-Restore answers its health check (Z-602)
  holen: async () => new Response(null, { status: 200 }),
  verbinden: async () => {},
});

export const einrichtungsAgent = (
  o: TestSystemOptionen & {
    anfang?: Record<string, string>;
    /** Other parts of the installations' deps (Z-602: the copy's health check) */
    installationen?: Partial<AuftraegeDeps["installationen"]>;
  } = {},
  fs = speicher(o.anfang ?? {}),
  sys = testSystem({ nutzer: [PFORTE], ...o }),
) => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  /** What the agent wrote to its own log, as lines */
  const logs: string[] = [];
  const plaene: { ms: number; lauf: () => void }[] = [];
  const agent = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: AUFTRAEGE,
    vertrauen: { schluessel, zweck: "test" },
    spawn: sys.spawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    installationen: { ...installationenAuf(sys), ...o.installationen },
    planen: (lauf, ms) => {
      plaene.push({ ms, lauf });
      return () => {};
    },
    jetzt: () => 1_800_000_000_000,
    log: (msg, mehr) => logs.push(JSON.stringify({ msg, ...mehr })),
  });
  const gesendet: Record<string, unknown>[] = [];
  const empfangen = (n: AuftragNachricht = einrichtenAuftrag()) =>
    agent.empfangen(n, (t) => gesendet.push(JSON.parse(t)));
  const ergebnis = () => (gesendet.at(-1) as { ergebnis?: unknown } | undefined)?.ergebnis;
  const record = (): Record<string, { zustand: string }> =>
    JSON.parse(fs.inhalt.get(INSTALLATIONEN)?.text ?? '{"installationen":{}}').installationen;
  /** The programs run, with the user they ran as: "useradd", "sz-x: podman pull" */
  const programme = () =>
    sys.laeufe.map((l) =>
      [
        l.als === "root" ? "" : `${l.als}: `,
        l.argv.slice(0, l.argv[0] === "systemctl" ? 3 : 2).join(" "),
      ].join(""),
    );
  return { sys, fs, plaene, gesendet, logs, empfangen, ergebnis, record, programme, agent };
};
