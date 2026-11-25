import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeobachteterDienst } from "@steuerzentrale/protokoll";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import type { Planer } from "../src/verbindung/verbinden.ts";
import { type BeobachtetDeps, beobachteteLesen } from "../src/zustand/beobachtet.ts";
import { echtVerbinden } from "../src/zustand/echt.ts";
import { EINRICHTUNG_BEREIT, nutzerLesen, sudoLesen } from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf, muss } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-1103 with real Podman and systemd (CI only, `bun run test:agent`): a Quadlet unit
 * written by hand under a Linux user of its own, which no setup job made, read as an observed
 * service: running it is active and its check on 127.0.0.1 green, stopped it is not active and the
 * check red with its reason, a unit that does not exist is unknown. Every argv the agent ran is
 * recorded: nothing but `systemctl show` (the check is a fetch and a socket, no program).
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;

const NUTZER = `sz-test-f${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
const UNIT = "fremd.service";
const PORT = 28_871;

// The example app 1.0.0 as scripts/beispiel-images.ts pushed it to the test registry
const image = () => {
  const text = readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");
  const treffer = /image: "([^"]+)"/.exec(text);
  if (!treffer?.[1]) throw new Error("no image in the example manifest");
  return treffer[1];
};

/** A Quadlet file as an operator would write it, not rendered by the Steuerzentrale */
const quadlet = () =>
  [
    "[Container]",
    `Image=${image()}`,
    `PublishPort=127.0.0.1:${PORT}:8080`,
    "Volume=fremd-daten:/daten",
    "",
    "[Service]",
    "Restart=no",
    "",
  ].join("\n");

const planen: Planer = (los, ms) => {
  const t = setTimeout(los, ms);
  return () => clearTimeout(t);
};

/** The agent's parts as on a server, root's through sudo; every argv recorded */
const deps = () => {
  const argvs: string[][] = [];
  const d: BeobachtetDeps = {
    nutzer: nutzerLesen,
    lesen: (argv, signal, o) => {
      argvs.push([...argv]);
      return sudoLesen(argv, signal, o);
    },
    spawn: async (argv) => {
      argvs.push([...argv]);
      throw new Error("no program but systemctl show may run");
    },
    holen: (url, init) => fetch(url, init),
    verbinden: echtVerbinden,
    planen,
  };
  return { d, argvs };
};

const DIENST: BeobachteterDienst = {
  dienstId: "d-fremd",
  nutzer: NUTZER,
  units: [UNIT],
  health: { art: "http", port: PORT, pfad: "/health" },
};

/** Rounds until the report fits, three minutes at most (the first start pulls the image) */
const bis = async (d: BeobachtetDeps, passt: (g: Awaited<ReturnType<typeof lesen>>) => boolean) => {
  let letzte = await lesen(d);
  for (let i = 0; i < 180 && !passt(letzte); i++) {
    await Bun.sleep(1000);
    letzte = await lesen(d);
  }
  return letzte;
};
const lesen = async (d: BeobachtetDeps) => (await beobachteteLesen(d, [DIENST]))[0];

/** Only `systemctl show`, as the user through runuser or of the system */
const nurShow = (argv: string[]) => {
  const ab = argv.indexOf("systemctl");
  const rest = argv.slice(ab + 1);
  const vorne = argv.slice(0, ab);
  const show = rest[0] === "--user" ? rest.slice(1) : rest;
  return (
    ab >= 0 &&
    (vorne.length === 0 || vorne[0] === "runuser") &&
    show[0] === "show" &&
    show[1] === "-p" &&
    show[2] === "Id,ActiveState,LoadState" &&
    show[3] === "--"
  );
};

describe.skipIf(!bereit)(
  "units no manifest describes, read as an observed service (Z-1103)",
  () => {
    const datei = join(tmpdir(), `${NUTZER}-fremd.container`);
    const als = () => alsNutzer(NUTZER);

    beforeAll(() => {
      muss(["sudo", "-n", "useradd", "--create-home", NUTZER]);
      muss(["sudo", "-n", "loginctl", "enable-linger", NUTZER]);
      const uid = muss(["id", "-u", NUTZER]);
      for (
        let i = 0;
        i < 30 && lauf(["sudo", "-n", "test", "-S", `/run/user/${uid}/bus`]).code;
        i++
      )
        Bun.sleepSync(1000);
      writeFileSync(datei, quadlet(), { mode: 0o644 });
      const ziel = `/home/${NUTZER}/.config/containers/systemd`;
      muss(als()("mkdir", "-p", ziel));
      muss(als()("cp", datei, `${ziel}/fremd.container`));
      muss(als()("systemctl", "--user", "daemon-reload"));
      muss(als()("systemctl", "--user", "start", UNIT), 300_000);
    }, 400_000);

    afterAll(() => {
      if (!bereit) return;
      lauf(alsNutzer(NUTZER)("systemctl", "--user", "stop", UNIT));
      lauf(["sudo", "-n", "loginctl", "disable-linger", NUTZER]);
      lauf(["sudo", "-n", "userdel", "--remove", "--force", NUTZER]);
      rmSync(datei, { force: true });
    });

    it("reports the running unit active and its check green", async () => {
      const { d, argvs } = deps();
      expect(await bis(d, (g) => g?.health.zustand === "gruen")).toEqual({
        dienstId: "d-fremd",
        units: [{ name: UNIT, aktiv: "active" }],
        health: { zustand: "gruen", grund: "HTTP 200" },
      });
      expect(argvs.length).toBeGreaterThan(0);
      expect(argvs.filter((a) => !nurShow(a))).toEqual([]);
    }, 300_000);

    it("reports the stopped unit not active and its check red with the reason", async () => {
      muss(als()("systemctl", "--user", "stop", UNIT), 120_000);
      const { d, argvs } = deps();
      const gestoppt = await bis(d, (g) => g?.health.zustand === "rot");
      expect(gestoppt?.health).toEqual({
        zustand: "rot",
        grund: `keine Verbindung zu 127.0.0.1:${PORT}`,
      });
      expect(gestoppt?.units[0]?.aktiv).not.toBe("active");
      expect(gestoppt?.units[0]?.aktiv).not.toBe("unknown");
      expect(argvs.filter((a) => !nurShow(a))).toEqual([]);
    }, 300_000);

    it("reports a unit that does not exist as unknown, of a user and of the system", async () => {
      const { d, argvs } = deps();
      const fehlt: BeobachteterDienst[] = [
        {
          dienstId: "d-u",
          nutzer: NUTZER,
          units: ["gibt-es-nicht.service"],
          health: { art: "keine" },
        },
        {
          dienstId: "d-s",
          nutzer: null,
          units: ["gibt-es-nicht.service"],
          health: { art: "keine" },
        },
        {
          dienstId: "d-j",
          nutzer: null,
          units: ["systemd-journald.service"],
          health: { art: "keine" },
        },
      ];
      const r = await beobachteteLesen(d, fehlt);
      expect(r.map((g) => g.units)).toEqual([
        [{ name: "gibt-es-nicht.service", aktiv: "unknown" }],
        [{ name: "gibt-es-nicht.service", aktiv: "unknown" }],
        [{ name: "systemd-journald.service", aktiv: "active" }],
      ]);
      expect(argvs.filter((a) => !nurShow(a))).toEqual([]);
    });
  },
);
