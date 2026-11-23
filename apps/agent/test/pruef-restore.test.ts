import { describe, expect, it } from "vitest";
import { MANIFEST, NAME } from "../src/einrichtung/testauftraege.ts";
import { type Aufgerufen, PFORTE, TEST_SNAPSHOT } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import {
  alsKopie,
  daten,
  eingerichtet,
  fehler,
  GEHEIM,
  KOPIE,
  KOPIE_NUTZER,
  kopieWeg,
  PASSWORT,
  pruefRestore,
  ZUGANG,
} from "./pruef-restore-hilfen.ts";

/*
 * BAULISTE.md Z-602, the agent's side of the Prüf-Restore (docs/plan.md, "Prüf-Restore auf dem
 * Server"), on a server in memory (testsystem.ts): the copy restore-<6> is set up like an
 * installation without its setup steps and without a start, the parts are played back by the
 * agent's binary as the copy's user, then its units start and its health is checked on its own
 * port; afterwards the copy is torn down, also after a failure in any step. The original is only
 * read. No value of the backup's access is in an argv, a result, the record or the agent's log: it
 * reaches the copy's user only on standard input.
 */

describe("installation_pruef_restore", () => {
  it("sets up the copy without its steps, plays the parts back, checks it on its own port and tears it down", async () => {
    const geholt: string[] = [];
    const a = await eingerichtet({
      installationen: {
        holen: async (url) => {
          geholt.push(url);
          return new Response(null, { status: 200 });
        },
      },
    });
    await a.empfangen(pruefRestore());
    const d = daten(a);
    expect(d.teile).toEqual([
      { tag: "volume:daten", snapshot: TEST_SNAPSHOT, zurueckgespielt: true, grund: null },
      {
        tag: "befehl:export",
        snapshot: null,
        zurueckgespielt: false,
        grund: "die Ausgabe eines Befehls ist ein Export, kein Restore",
      },
    ]);
    expect(d.dauerMs).toBeGreaterThanOrEqual(0);
    expect(geholt).toEqual(["http://127.0.0.1:20011/health"]);
    const ablauf = alsKopie(a);
    const index = (s: string) => ablauf.findIndex((x) => x.startsWith(s));
    // volumes and network before the playback, the units only after it; no setup step
    expect(index("systemctl --user daemon-reload")).toBeLessThan(
      index(`systemctl --user start ${KOPIE}-network.service`),
    );
    expect(index(`systemctl --user start ${KOPIE}-network.service`)).toBeLessThan(
      index("/usr/local/bin/steuerzentrale-agent zurueckspielen"),
    );
    expect(index("/usr/local/bin/steuerzentrale-agent zurueckspielen")).toBeLessThan(
      index(`systemctl --user start ${KOPIE}-app.service`),
    );
    expect(ablauf).toContain(`systemctl --user start ${KOPIE}-network.service`);
    expect(ablauf.filter((x) => x.startsWith("podman exec"))).toEqual([]);
    const start = a
      .seither()
      .find((l) => l.argv[2] === "start" && l.argv.includes(`${KOPIE}-network.service`));
    expect(start?.argv).toEqual([
      "systemctl",
      "--user",
      "start",
      `${KOPIE}-network.service`,
      `${KOPIE}-daten-volume.service`,
    ]);
    // the Pforte is not touched for the copy: it gets no route
    expect(a.seither().filter((l) => l.als === PFORTE.name)).toEqual([]);
    kopieWeg(a);
  });

  it("hands the backup's access to the copy's user only on standard input, never in an argv, result or log", async () => {
    const a = await eingerichtet();
    await a.empfangen(pruefRestore());
    expect(daten(a).teile[0]?.zurueckgespielt).toBe(true);
    const spielen = a.seither().filter((l) => l.argv[1] === "zurueckspielen");
    expect(spielen.map((l) => [l.als, l.argv])).toEqual([
      [KOPIE_NUTZER, ["/usr/local/bin/steuerzentrale-agent", "zurueckspielen", KOPIE]],
    ]);
    expect(JSON.parse(spielen[0]?.eingabe ?? "{}")).toEqual({
      quelle: NAME,
      ...ZUGANG,
      teil: {
        art: "volume",
        tag: "volume:daten",
        volume: `${KOPIE}-daten`,
        pfad: "/sicherung/daten",
      },
    });
    for (const wert of [PASSWORT, GEHEIM]) {
      expect(JSON.stringify(a.sys.laeufe.map((l) => [l.argv, l.umgebung]))).not.toContain(wert);
      expect(JSON.stringify([a.gesendet, a.logs, a.record()])).not.toContain(wert);
    }
  });

  it("plays a dump back once the database's container alone runs and answers", async () => {
    const manifest = ersetzen(
      MANIFEST,
      "  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }",
      "  - { art: pg_dump, container: app, datenbank: beispiel, nutzer: beispiel }",
    );
    const a = await eingerichtet({ manifest });
    await a.empfangen(pruefRestore({ manifest, signatur: signiert(manifest) }));
    expect(daten(a).teile).toEqual([
      { tag: "pg_dump:app:beispiel", snapshot: TEST_SNAPSHOT, zurueckgespielt: true, grund: null },
    ]);
    const ablauf = a.seither().filter((l) => l.als === KOPIE_NUTZER);
    const i = (f: (l: Aufgerufen) => boolean) => ablauf.findIndex(f);
    const dbStart = i((l) => l.argv[2] === "start" && l.argv[3] === `${KOPIE}-app.service`);
    const bereit = i((l) => l.argv.includes("pg_isready"));
    const spielen = i((l) => l.argv[1] === "zurueckspielen");
    expect(dbStart).toBeGreaterThan(-1);
    expect(ablauf[bereit]?.argv).toEqual([
      "podman",
      "exec",
      `${KOPIE}-app`,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-d",
      "beispiel",
      "-U",
      "beispiel",
    ]);
    expect(dbStart).toBeLessThan(bereit);
    expect(bereit).toBeLessThan(spielen);
    expect(JSON.parse(ablauf[spielen]?.eingabe ?? "{}").teil).toEqual({
      art: "pg_dump",
      tag: "pg_dump:app:beispiel",
      container: `${KOPIE}-app`,
      datei: "/app-beispiel.dump",
      argv: ["pg_restore", "--clean", "--if-exists", "-d", "beispiel", "-U", "beispiel"],
    });
    kopieWeg(a);
  });
});

describe("a Prüf-Restore that fails is torn down all the same", () => {
  const bei = (f: (l: Aufgerufen) => boolean) => (l: Aufgerufen) => (f(l) ? 1 : undefined);
  it.each([
    [
      "useradd of the copy",
      bei((l) => l.argv[0] === "useradd" && l.argv.at(-1) === KOPIE_NUTZER),
      "Kopie einrichten: useradd: endete mit Code 1",
    ],
    [
      "pulling its image",
      bei((l) => l.als === KOPIE_NUTZER && l.argv[1] === "pull"),
      "Kopie einrichten: podman pull",
    ],
    [
      "creating its volumes",
      bei((l) => l.als === KOPIE_NUTZER && l.argv.includes(`${KOPIE}-network.service`)),
      "Zurückspielen: systemctl --user start: endete mit Code 1",
    ],
    [
      "playing a part back",
      bei((l) => l.argv[1] === "zurueckspielen"),
      "Zurückspielen: volume:daten: zurueckspielen endete mit Code 1",
    ],
    [
      "starting its units",
      bei(
        (l) =>
          l.als === KOPIE_NUTZER && l.argv[2] === "start" && l.argv[3] === `${KOPIE}-app.service`,
      ),
      "Start der Kopie: systemctl --user start: endete mit Code 1",
    ],
  ] as const)("after %s", async (_was, scheitern, grund) => {
    const a = await eingerichtet({ scheitern });
    await a.empfangen(pruefRestore());
    expect(fehler(a)).toContain(`Prüf-Restore gescheitert: ${grund}`);
    expect(fehler(a)).not.toContain("Abbau");
    kopieWeg(a);
  });

  it("when the copy's health stays red, with the last reason", async () => {
    const a = await eingerichtet({
      installationen: { holen: async () => new Response(null, { status: 503 }) },
    });
    await a.empfangen(pruefRestore());
    expect(fehler(a)).toBe("Prüf-Restore gescheitert: Health: HTTP 503");
    kopieWeg(a);
  });

  it("names a part's reason from the binary", async () => {
    const manifest = ersetzen(
      MANIFEST,
      "  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }",
      "  - { art: volume, volume: daten }\n  - { art: pg_dump, container: app, datenbank: b, nutzer: b }",
    );
    const a = await eingerichtet({
      manifest,
      scheitern: bei((l) => l.argv[1] === "zurueckspielen"),
      ausgabe: (l) =>
        l.argv[1] === "zurueckspielen"
          ? `${JSON.stringify({ ok: false, grund: "restic dump: restic endete mit Code 1", snapshot: TEST_SNAPSHOT })}\n`
          : undefined,
    });
    await a.empfangen(pruefRestore({ manifest, signatur: signiert(manifest) }));
    expect(fehler(a)).toBe(
      "Prüf-Restore gescheitert: Zurückspielen: volume:daten: restic dump: restic endete mit Code 1",
    );
    kopieWeg(a);
  });
});
