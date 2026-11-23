import { unitLesen } from "@steuerzentrale/manifest";
import { imContainer } from "../auftraege/ausfuehren.ts";
import { hausPlan, hausSchreiben } from "./haus.ts";
import { bisJa, type Lauf } from "./lauf.ts";
import { alsNutzer, busSocket, homeVon, type Nutzer, nutzerName } from "./nutzer.ts";
import {
  type Einrichten,
  gelungen,
  gescheitert,
  type Schritt,
  type Schrittergebnis,
  type SystemDeps,
} from "./typen.ts";

/*
 * Setting up an installation on its server (BAULISTE.md Z-402; docs/plan.md, "Einrichten auf dem
 * Server"), each step a fixed argv without a shell, in this order: the Linux user sz-<name> (home
 * 0700, no login shell), lingering, waiting for its user manager, the units, slice and `dateien`
 * owned by it, the Podman secrets through standard input (never in an argv, which every user sees
 * in the process list), each image pulled by its digest, daemon-reload and start of the units,
 * waiting until they are active, then the commands of `schritte.einrichten` in their containers
 * (vorbereiten is all before the start, which a Prüf-Restore uses for its copy, Z-602).
 * Everything after useradd runs as that user. The first failing step ends it; tearing down is the
 * caller's (auftrag.ts), so nothing is left half set up.
 */

const WARTEN_MS = 500;
/** systemd's user manager starts with lingering; its bus is there within a minute */
const BUS_VERSUCHE = 120;
/** The units are started by then; Quadlet's services report active once the container runs */
const AKTIV_VERSUCHE = 240;

type Kontext = { deps: SystemDeps; a: Einrichten; lauf: Lauf; auftrag?: AbortSignal };

type Fehlschlag = { ok: false; grund: string };
const fehlschlag = (grund: string): Fehlschlag => ({ ok: false, grund });

const nutzerAnlegen = async (k: Kontext): Promise<Nutzer | Fehlschlag> => {
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
  if (!n) return fehlschlag(`useradd: ${name} is not there afterwards`);
  if (n.home !== home) return fehlschlag(`useradd: ${name} has the home ${n.home}, not ${home}`);
  const ohne = await ohneUntergeordneteIds(k, name);
  if (ohne) return fehlschlag(`useradd: ${name} has no subordinate ids in ${ohne}`);
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

export const nacheinander = async (
  laeufe: (() => Promise<Schrittergebnis>)[],
): Promise<Schrittergebnis> => {
  for (const lauf of laeufe) {
    const r = await lauf();
    if (!r.ok) return r;
  }
  return gelungen;
};

/**
 * Each step runs even when one before failed, as when bringing an old state back; the first
 * failure is the answer
 */
export const alleVersuchen = async (
  laeufe: (() => Promise<Schrittergebnis>)[],
): Promise<Schrittergebnis> => {
  let erster: Schrittergebnis = gelungen;
  for (const lauf of laeufe) {
    const r = await lauf();
    if (!r.ok && erster.ok) erster = r;
  }
  return erster;
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

/** `systemctl --user is-active --quiet` of the units: all of them active */
export const sindAktiv = async (lauf: Lauf, n: Nutzer, units: readonly string[]) =>
  (
    await lauf(
      "systemctl --user is-active",
      alsNutzer(n, ["systemctl", "--user", "is-active", "--quiet", ...units]),
    )
  ).ok;

/** Asks the user's systemd until all the units are active, or gives up */
export const bisAktiv = async (
  deps: Pick<SystemDeps, "warten">,
  lauf: Lauf,
  n: Nutzer,
  units: readonly string[],
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const frage = () => sindAktiv(lauf, n, units);
  const aktiv = await bisJa(deps, AKTIV_VERSUCHE, WARTEN_MS, frage, auftrag);
  return aktiv ? gelungen : gescheitert(`units not active: ${units.join(", ")}`);
};

const neuLaden = (k: Kontext, n: Nutzer) =>
  k.lauf("systemctl --user daemon-reload", alsNutzer(n, ["systemctl", "--user", "daemon-reload"]));

/** Starts the units and waits until all of them are active */
export const unitsStarten = async (
  deps: Pick<SystemDeps, "warten">,
  lauf: Lauf,
  n: Nutzer,
  units: readonly string[],
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const gestartet = await lauf(
    "systemctl --user start",
    alsNutzer(n, ["systemctl", "--user", "start", ...units]),
  );
  if (!gestartet.ok) return gestartet;
  return bisAktiv(deps, lauf, n, units, auftrag);
};

/**
 * The commands of `schritte.einrichten` (or `schritte.nach_update`, Z-503) one after the other:
 * `podman exec <installation>-<container>`, the container's name from its unit, marked (imContainer)
 */
export const schritteAusfuehren = (
  lauf: Lauf,
  n: Nutzer,
  installation: string,
  schritte: readonly Schritt[],
  art = "schritte.einrichten",
) =>
  nacheinander(
    schritte.map((s) => () => {
      const { argv, marke } = imContainer(n, `${installation}-${s.container}`, s.argv);
      return lauf(`${art} ${s.name}`, argv, { zeitlimitMs: s.zeitlimitMs, marke });
    }),
  );

/**
 * Everything of setting up before the units start: the user, lingering, the files, the secrets,
 * the images and daemon-reload; the user when it went through. A Prüf-Restore (Z-602) plays the
 * snapshots back into the copy at this point, before anything of it ran
 */
export const vorbereiten = async (
  deps: SystemDeps,
  a: Einrichten,
  lauf: Lauf,
  auftrag?: AbortSignal,
): Promise<{ ok: true; nutzer: Nutzer } | Fehlschlag> => {
  const k: Kontext = { deps, a, lauf, ...(auftrag ? { auftrag } : {}) };
  try {
    const n = await nutzerAnlegen(k);
    if ("ok" in n) return n;
    const r = await nacheinander([
      () => bereitstellen(k, n),
      () => secretsUndImages(k, n),
      () => neuLaden(k, n),
    ]);
    return r.ok ? { ok: true, nutzer: n } : fehlschlag(r.grund);
  } catch (fehler) {
    // writing into the home threw (haus.ts): a step like any other
    return fehlschlag(String(fehler).slice(0, 500));
  }
};

export const einrichten = async (
  deps: SystemDeps,
  a: Einrichten,
  lauf: Lauf,
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const v = await vorbereiten(deps, a, lauf, auftrag);
  if (!v.ok) return v;
  return nacheinander([
    () => unitsStarten(deps, lauf, v.nutzer, a.units, auftrag),
    () => schritteAusfuehren(lauf, v.nutzer, a.name, a.schritte),
  ]);
};
