import { PFORTE_UNIT, pforteUnit } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import type { AuftragNachricht } from "../auftraege/pruefen.ts";
import {
  EINRICHTUNG,
  eingerichtet,
  einrichtenAuftrag,
  einrichtungsAgent,
  GEHEIM,
  HOME,
  IMAGE,
  MANIFEST,
  NAME,
  NUTZER,
} from "./testauftraege.ts";
import { PFORTE } from "./testsystem.ts";

/*
 * BAULISTE.md Z-402, the agent's side (docs/plan.md, "Einrichten auf dem Server"): a setup job
 * renders the units from the signed manifest, writes and starts the Pforte's unit first, makes
 * sz-<name> and sets the installation up as that user with fixed argv; a job it refuses (changed
 * manifest, invalid name, port out of range, unknown option) makes nothing; a command of a job then
 * runs as the installation's user. Failing and tearing down: abbauen.test.ts. On a server in memory
 * (testsystem.ts).
 */

const UNIT_ORDNER = `${HOME}/.config/containers/systemd`;
const UNITS = [`${NAME}-app.service`];

describe("a setup job", () => {
  it("sets up the installation as its own user, step by step, and reports it", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    expect(a.gesendet).toEqual([
      { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId: "e1" },
      expect.objectContaining({ typ: "fortschritt", schritt: "installation_einrichten" }),
      expect.objectContaining({
        typ: "ergebnis",
        ergebnis: { ok: true, daten: { installation: NAME, geaendert: "neu", units: UNITS } },
      }),
    ]);
    expect(a.programme()).toEqual([
      "sz-pforte: systemctl --user daemon-reload",
      "sz-pforte: systemctl --user start",
      "useradd --create-home",
      "loginctl enable-linger",
      `${NUTZER}: podman secret`,
      `${NUTZER}: podman pull`,
      `${NUTZER}: systemctl --user daemon-reload`,
      `${NUTZER}: systemctl --user start`,
      `${NUTZER}: systemctl --user is-active`,
      `${NUTZER}: podman exec`,
    ]);
    // what the health check needs (Z-403): the units, and netz.http's assigned port on 127.0.0.1
    expect(a.record()).toEqual({
      [NAME]: {
        zustand: "fertig",
        am: expect.any(Number),
        pruefung: { units: UNITS, ziel: { art: "http", port: 20001, pfad: "/health" } },
      },
    });
  });

  it("makes the user with a home of its own and no login shell", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    expect(a.sys.laeufe.find((l) => l.argv[0] === "useradd")?.argv).toEqual([
      "useradd",
      "--create-home",
      "--home-dir",
      HOME,
      "--shell",
      "/usr/sbin/nologin",
      "--user-group",
      "--comment",
      `Steuerzentrale ${NAME}`,
      NUTZER,
    ]);
    const n = a.sys.nutzer.get(NUTZER);
    expect(a.sys.dateien.get(HOME)).toEqual({
      art: "verzeichnis",
      modus: 0o700,
      uid: n?.uid,
      gid: n?.gid,
    });
  });

  it("runs everything after useradd as the user, with a fixed environment and no shell", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const n = a.sys.nutzer.get(NUTZER);
    const alsNutzer = a.sys.laeufe.filter((l) => l.als === NUTZER);
    expect(alsNutzer.length).toBeGreaterThan(5);
    for (const l of alsNutzer)
      expect(l.umgebung).toEqual([
        `HOME=${HOME}`,
        `USER=${NUTZER}`,
        `LOGNAME=${NUTZER}`,
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        `XDG_RUNTIME_DIR=/run/user/${n?.uid}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${n?.uid}/bus`,
      ]);
    expect(a.sys.laeufe.flatMap((l) => l.argv)).not.toContain("sh");
  });

  it("writes units, slice and files owned by the user, closed to everyone else", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const n = a.sys.nutzer.get(NUTZER);
    const eigen = { uid: n?.uid, gid: n?.gid };
    expect(a.sys.dateien.get(`${UNIT_ORDNER}/${NAME}-app.container`)).toMatchObject({
      art: "datei",
      modus: 0o600,
      ...eigen,
    });
    expect(a.sys.dateien.get(`${UNIT_ORDNER}/${NAME}.network`)).toMatchObject({ modus: 0o600 });
    expect(a.sys.dateien.get(`${HOME}/.config/systemd/user/${NAME}.slice`)).toMatchObject({
      modus: 0o600,
      ...eigen,
    });
    // mounted read-only into the container, whose process is not the owner: readable, in a home 0700
    expect(
      a.sys.dateien.get(`${HOME}/.config/steuerzentrale/dateien/app/etc/beispiel/titel.txt`),
    ).toMatchObject({ inhalt: "Beispiel", modus: 0o644, ...eigen });
    for (const pfad of a.sys.unter(HOME)) {
      const e = a.sys.dateien.get(pfad);
      expect(e, pfad).toMatchObject(eigen);
      if (e?.art === "verzeichnis") expect(e.modus, pfad).toBe(0o700);
    }
  });

  it("hands each secret to Podman on standard input, never in an argv or a file", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const secret = a.sys.laeufe.find((l) => l.argv[1] === "secret");
    expect(secret?.argv).toEqual([
      "podman",
      "secret",
      "create",
      `${NAME}-beispiel-schluessel`,
      "-",
    ]);
    expect(secret?.eingabe).toBe(GEHEIM);
    expect(a.sys.secrets.get(NUTZER)?.get(`${NAME}-beispiel-schluessel`)).toBe(GEHEIM);
    expect(JSON.stringify(a.sys.laeufe.map((l) => l.argv))).not.toContain(GEHEIM);
    for (const pfad of a.sys.unter(HOME))
      expect(a.sys.dateien.get(pfad)?.inhalt ?? "", pfad).not.toContain(GEHEIM);
    expect(JSON.stringify(a.gesendet)).not.toContain(GEHEIM);
    expect([...a.fs.inhalt.values()].map((d) => d.text).join("\n")).not.toContain(GEHEIM);
  });

  it("pulls each image by its digest, starts the units and runs schritte.einrichten in its container", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const argv = (programm: string, teil: string) =>
      a.sys.laeufe
        .filter((l) => l.als === NUTZER && l.argv[0] === programm && l.argv[1] === teil)
        .map((l) => l.argv);
    expect(argv("podman", "pull")).toEqual([["podman", "pull", IMAGE]]);
    expect(argv("systemctl", "--user").map((x) => x.slice(2))).toEqual([
      ["daemon-reload"],
      ["start", ...UNITS],
      ["is-active", "--quiet", ...UNITS],
    ]);
    expect(argv("podman", "exec")).toEqual([
      ["podman", "exec", `${NAME}-app`, "bun", "/app/server.ts", "migrieren"],
    ]);
    // marked, so that at its time limit the step's command under conmon is killed too (the test
    // system takes the mark off the argv only when it is the one spawn was given)
    expect(
      a.sys.laeufe.filter((l) => l.argv[1] === "exec").map((l) => l.marke !== undefined),
    ).toEqual([true]);
  });

  it("waits for the units to be active before the setup steps", async () => {
    let gefragt = 0;
    const a = einrichtungsAgent({
      scheitern: (l) => (l.argv[2] === "is-active" && ++gefragt < 3 ? 3 : undefined),
    });
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({ ok: true });
    expect(a.programme().filter((p) => p.endsWith("is-active"))).toHaveLength(3);
    expect(a.programme().at(-1)).toBe(`${NUTZER}: podman exec`);
  });

  it("takes the shorter time limit of the Zentrale's and its own 30 minutes", async () => {
    const kurz = einrichtungsAgent();
    await kurz.empfangen(einrichtenAuftrag({ zeitlimitS: 600 }));
    expect(kurz.plaene.map((p) => p.ms)).toContain(600_000);
    const lang = einrichtungsAgent();
    await lang.empfangen(einrichtenAuftrag({ zeitlimitS: 7200 }));
    expect(lang.plaene.map((p) => p.ms)).toContain(1_800_000);
    expect(lang.plaene.map((p) => p.ms)).not.toContain(7_200_000);
  });
});

describe("the Pforte, before an app behind it is set up", () => {
  it("gets its unit written under sz-pforte and started", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    expect(a.sys.dateien.get(`${PFORTE.home}/.config/containers/systemd/${PFORTE_UNIT}`)).toEqual({
      art: "datei",
      inhalt: pforteUnit(),
      modus: 0o600,
      uid: PFORTE.uid,
      gid: PFORTE.gid,
    });
    expect(a.sys.aktiv.get("sz-pforte")).toEqual(new Set(["sz-pforte.service"]));
  });

  it("is written once: a second installation only makes sure it runs", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    await a.empfangen(einrichtenAuftrag({ auftragId: "e2", installationId: "beispiel-zweite" }));
    expect(a.ergebnis()).toMatchObject({ ok: true });
    expect(a.programme().filter((p) => p.startsWith("sz-pforte:"))).toEqual([
      "sz-pforte: systemctl --user daemon-reload",
      "sz-pforte: systemctl --user start",
      "sz-pforte: systemctl --user start",
    ]);
  });

  it("is missing without sz-pforte: the job fails with the reason and makes nothing", async () => {
    const a = einrichtungsAgent({ nutzer: [] });
    await a.empfangen();
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "Einrichten gescheitert: sz-pforte is missing: install.sh makes the Pforte's user",
    });
    expect(a.sys.laeufe).toEqual([]);
    expect(a.record()).toEqual({});
  });
});

describe("a setup job the agent refuses, making nothing", () => {
  const mitInstallation = (i: Record<string, unknown>): Partial<AuftragNachricht> => ({
    einrichtung: { ...EINRICHTUNG, installation: { ...EINRICHTUNG.installation, ...i } },
  });
  it.each([
    [
      "a manifest changed in one byte",
      { manifest: MANIFEST.replace("migrieren]", "migrierem]") },
      "(signature): signature does not match",
    ],
    [
      "an invalid name",
      { installationId: "Beispiel" },
      "a setup job belongs to a named installation",
    ],
    [
      "the Pforte's name",
      { installationId: "pforte" },
      "a setup job belongs to a named installation",
    ],
    [
      "a name like an option",
      { installationId: "--privileged" },
      "a setup job belongs to a named installation",
    ],
    [
      "a privileged port",
      mitInstallation({ httpPort: 80 }),
      "httpPort: an integer from 1024 to 65535",
    ],
    [
      "a port above 65535",
      mitInstallation({ ports: { "app:9000": 70000 } }),
      "ports.app:9000: an integer from 1024 to 65535",
    ],
    [
      "an unknown option",
      mitInstallation({ optionen: ["gibtsnicht"] }),
      "no option named gibtsnicht",
    ],
    ["an argument", { argumente: { image: "docker.io/evil" } }, "unknown argument image"],
    ["no installation data", { einrichtung: undefined }, "setting up needs the installation data"],
  ] as [string, Partial<AuftragNachricht>, string][])("%s", async (_fall, teil, grund) => {
    const a = einrichtungsAgent();
    await a.empfangen(einrichtenAuftrag(teil));
    expect(a.ergebnis()).toEqual({ ok: false, fehler: expect.stringContaining(grund) });
    expect((a.ergebnis() as { fehler: string }).fehler).toMatch(/^abgelehnt: /);
    expect(a.sys.laeufe).toEqual([]);
    expect(a.sys.unter("/home/sz-pforte")).toEqual([]);
    expect(a.record()).toEqual({});
  });

  it("installation data on any other job", async () => {
    const a = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "fertig" }) });
    await a.empfangen(einrichtenAuftrag({ aktion: "migrieren", einrichtung: EINRICHTUNG }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: only a setup job carries installation data (einrichtung)",
    });
    expect(a.sys.laeufe).toEqual([]);
  });
});

describe("commands of a job after setting up", () => {
  it("run as the installation's user in its container", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const bis = a.sys.laeufe.length;
    await a.empfangen(
      einrichtenAuftrag({ auftragId: "b1", aktion: "export", einrichtung: undefined }),
    );
    expect(a.ergebnis()).toEqual({ ok: true, daten: { code: 0 } });
    expect(a.sys.laeufe.slice(bis).map((l) => [l.als, ...l.argv])).toEqual([
      [NUTZER, "podman", "exec", `${NAME}-app`, "bun", "/app/server.ts", "export"],
    ]);
  });
});
