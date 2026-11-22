import { unitLesen } from "@steuerzentrale/manifest";
import { imContainer } from "../auftraege/ausfuehren.ts";
import { hausPlan, hausSchreiben } from "./haus.ts";
import { bisJa, type Lauf } from "./lauf.ts";
import { alsNutzer, busSocket, homeVon, type Nutzer, nutzerName } from "./nutzer.ts";
import {
  type Einrichten,
  gelungen,
  gescheitert,
  type Schrittergebnis,
  type SystemDeps,
} from "./typen.ts";

/*
 * Setting up an installation on its server (BAULISTE.md Z-402; docs/plan.md, "Einrichten auf dem
 * Server"), each step a fixed argv without a shell, in this order: the Linux user sz-<name> (home
 * 0700, no login shell), lingering, waiting for its user manager, the units, slice and `dateien`
 * owned by it, the Podman secrets through standard input (never in an argv, which every user sees
 * in the process list), each image pulled by its digest, daemon-reload and start of the units,
 * waiting until they are active, then the commands of `schritte.einrichten` in their containers.
 * Everything after useradd runs as that user. The first failing step ends it; tearing down is the
 * caller's (auftrag.ts), so nothing is left half set up.
 */

const WARTEN_MS = 500;
/** systemd's user manager starts with lingering; its bus is there within a minute */
const BUS_VERSUCHE = 120;
/** The units are started by then; Quadlet's services report active once the container runs */
const AKTIV_VERSUCHE = 240;

type Kontext = { deps: SystemDeps; a: Einrichten; lauf: Lauf; auftrag?: AbortSignal };

const nutzerAnlegen = async (k: Kontext): Promise<Nutzer | Schrittergebnis> => {
  const name = nutzerName(k.a.name);
  const home = homeVon(k.a.name);
  const r = await k.lauf("useradd", [
    "useradd",
    "--create-home",
    "--home-dir",
    home,
    "--shell",
    "/usr/sbin/nologin",
    "--user-group",
    "--comment",
    `Steuerzentrale ${k.a.name}`,
    name,
  ]);
  if (!r.ok) return r;
  const n = await k.deps.nutzer(name);
  if (!n) return gescheitert(`useradd: ${name} is not there afterwards`);
  if (n.home !== home) return gescheitert(`useradd: ${name} has the home ${n.home}, not ${home}`);
  const ohne = await ohneUntergeordneteIds(k, name);
  if (ohne) return gescheitert(`useradd: ${name} has no subordinate ids in ${ohne}`);
  await k.deps.haus.verzeichnis(home, 0o700, n);
  return n;
};

/**
 * Rootless Podman maps a container's users to the user's subordinate ids; useradd gives them where
 * /etc/subuid exists (install.sh checks the same for sz-pforte). Without them the pull fails later
 * with a less clear reason
 */
const ohneUntergeordneteIds = async (k: Kontext, name: string): Promise<string | undefined> => {
  for (const datei of ["/etc/subuid", "/etc/subgid"]) {
    const text = (await k.deps.haus.lesen(datei)) ?? "";
    if (!text.split("\n").some((z) => z.startsWith(`${name}:`))) return datei;
  }
  return undefined;
};

const bereitstellen = async (k: Kontext, n: Nutzer): Promise<Schrittergebnis> => {
  const linger = await k.lauf("loginctl enable-linger", ["loginctl", "enable-linger", n.name]);
  if (!linger.ok) return linger;
  const bus = await bisJa(
    k.deps,
    BUS_VERSUCHE,
    WARTEN_MS,
    () => k.deps.haus.existiert(busSocket(n)),
    k.auftrag,
  );
  if (!bus) return gescheitert(`the user manager of ${n.name} did not start (${busSocket(n)})`);
  await hausSchreiben(k.deps.haus, hausPlan(n.home, k.a.quadlets), n);
  return gelungen;
};

/** The images of the containers, as the units name them: by digest (eingabe.ts refuses others) */
export const imagesDerUnits = (units: Readonly<Record<string, string>>): string[] => [
  ...new Set(
    Object.entries(units)
      .filter(([datei]) => datei.endsWith(".container"))
      .flatMap(([, text]) =>
        unitLesen(text)
          .filter((a) => a.name === "Container")
          .flatMap((a) => a.zeilen.filter(([k]) => k === "Image").map(([, w]) => w)),
      ),
  ),
];

const nacheinander = async (
  laeufe: (() => Promise<Schrittergebnis>)[],
): Promise<Schrittergebnis> => {
  for (const lauf of laeufe) {
    const r = await lauf();
    if (!r.ok) return r;
  }
  return gelungen;
};

const secretsUndImages = (k: Kontext, n: Nutzer) =>
  nacheinander([
    ...Object.entries(k.a.quadlets.secrets).map(
      ([name, wert]) =>
        () =>
          k.lauf(
            `podman secret create ${name}`,
            alsNutzer(n, ["podman", "secret", "create", name, "-"]),
            { eingabe: wert },
          ),
    ),
    ...imagesDerUnits(k.a.quadlets.units).map(
      (image) => () => k.lauf(`podman pull ${image}`, alsNutzer(n, ["podman", "pull", image])),
    ),
  ]);

const unitsStarten = async (k: Kontext, n: Nutzer): Promise<Schrittergebnis> => {
  const systemctl = (...argv: string[]) => alsNutzer(n, ["systemctl", "--user", ...argv]);
  const gestartet = await nacheinander([
    () => k.lauf("systemctl --user daemon-reload", systemctl("daemon-reload")),
    () => k.lauf("systemctl --user start", systemctl("start", ...k.a.units)),
  ]);
  if (!gestartet.ok) return gestartet;
  const aktiv = await bisJa(
    k.deps,
    AKTIV_VERSUCHE,
    WARTEN_MS,
    async () =>
      (await k.lauf("systemctl --user is-active", systemctl("is-active", "--quiet", ...k.a.units)))
        .ok,
    k.auftrag,
  );
  return aktiv ? gelungen : gescheitert(`units not active: ${k.a.units.join(", ")}`);
};

/** `podman exec <installation>-<container>`, the container's name from its unit, marked (imContainer) */
const schritteAusfuehren = (k: Kontext, n: Nutzer) =>
  nacheinander(
    k.a.schritte.map((s) => () => {
      const { argv, marke } = imContainer(n, `${k.a.name}-${s.container}`, s.argv);
      return k.lauf(`schritte.einrichten ${s.name}`, argv, { zeitlimitMs: s.zeitlimitMs, marke });
    }),
  );

export const einrichten = async (
  deps: SystemDeps,
  a: Einrichten,
  lauf: Lauf,
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const k: Kontext = { deps, a, lauf, ...(auftrag ? { auftrag } : {}) };
  try {
    const n = await nutzerAnlegen(k);
    if ("ok" in n) return n;
    return await nacheinander([
      () => bereitstellen(k, n),
      () => secretsUndImages(k, n),
      () => unitsStarten(k, n),
      () => schritteAusfuehren(k, n),
    ]);
  } catch (fehler) {
    // writing into the home threw (haus.ts): a step like any other
    return gescheitert(String(fehler).slice(0, 500));
  }
};
