import { describe, expect, it } from "vitest";
import { MANIFEST, NAME, NUTZER } from "../src/einrichtung/testauftraege.ts";
import { imBinary } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import { eingerichtet, GEHEIM, PASSWORT } from "./pruef-restore-hilfen.ts";
import {
  APP_CONTAINER,
  IMAGE_NEU,
  laufendeVersion,
  NEU,
  UNITS_ORDNER,
  unitDateien,
  update,
  updateDaten,
  version,
} from "./update-hilfen.ts";
import { alsInstallation, systemctl, UNIT_APP } from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-503, the agent's side of an update (docs/plan.md, "Update auf dem Server
 * (Z-503)"), on a server in memory (testsystem.ts): the backup's timer stopped, the old state kept,
 * the new image pulled by its digest, the old units stopped, the new version's units, files and
 * secrets written, daemon-reload, the units restarted and staying active, `schritte.nach_update`
 * run with `podman exec`, the health by the new manifest; then the record keeps the new units and
 * the timer runs again. Nothing of the backup's access or of a secret reaches an argv, the result,
 * the record or the log, and no unit carries AutoUpdate.
 */

const TIMER = "sz_backup.timer";

describe("installation_update", () => {
  it("brings the installation to the new version and runs schritte.nach_update", async () => {
    const geholt: string[] = [];
    const a = await eingerichtet({
      installationen: {
        holen: async (url) => {
          geholt.push(url);
          return new Response(null, { status: 200 });
        },
      },
    });
    expect(laufendeVersion(a)).toBe("1.0.0");
    await a.empfangen(update());
    const d = updateDaten(a);
    expect(d).toEqual({ ergebnis: "aktualisiert", dauerMs: expect.any(Number) });
    expect(laufendeVersion(a)).toBe("2.0.0");
    expect(a.sys.dateien.get(APP_CONTAINER)?.inhalt).toContain(`Image=${IMAGE_NEU}`);
    expect(geholt).toEqual(["http://127.0.0.1:20001/health"]);
    const ablauf = alsInstallation(a)
      .filter((l) => !l.gelesen)
      .map((l) => imBinary(l.argv).slice(0, 4).join(" "));
    const secret = ablauf.find((z) => z.startsWith("podman secret create"))?.split(" ")[3];
    expect(ablauf).toEqual([
      `systemctl --user stop ${TIMER}`,
      `podman pull ${IMAGE_NEU}`,
      `systemctl --user stop ${UNIT_APP}`,
      `podman secret rm ${secret}`,
      `podman secret create ${secret}`,
      "systemctl --user daemon-reload",
      `systemctl --user reset-failed ${UNIT_APP}`,
      `systemctl --user restart ${UNIT_APP}`,
      // active, and still active for ten seconds (einrichtung/neustarten.ts)
      ...Array(11).fill(`systemctl --user is-active --quiet`),
      `podman exec ${NAME}-app bun`,
      `systemctl --user start ${TIMER}`,
    ]);
    const schritt = alsInstallation(a).find((l) => l.argv[1] === "exec");
    expect(schritt?.argv).toEqual([
      "podman",
      "exec",
      `${NAME}-app`,
      "bun",
      "/app/server.ts",
      "migrieren",
    ]);
  });

  it("keeps the new units, health target and secret names in the record", async () => {
    const a = await eingerichtet();
    await a.empfangen(update());
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    expect(a.record()[NAME]).toMatchObject({
      zustand: "fertig",
      pruefung: { units: [UNIT_APP], ziel: { art: "http", port: 20001, pfad: "/health" } },
      geheim: ["BEISPIEL_SCHLUESSEL"],
    });
  });

  it("writes units without AutoUpdate: updates come only through the waves", async () => {
    const a = await eingerichtet();
    await a.empfangen(update());
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    for (const text of Object.values(unitDateien(a))) expect(text).not.toContain("AutoUpdate");
  });

  it("removes the unit of a container the new version no longer has, after stopping it", async () => {
    const mitCache = ersetzen(
      MANIFEST,
      "optionen:\n",
      [
        "  - name: cache",
        `    image: "localhost:5000/cache@sha256:${"c".repeat(64)}"`,
        "optionen:\n",
      ].join("\n"),
    );
    const a = await eingerichtet({ manifest: mitCache });
    expect(Object.keys(unitDateien(a))).toContain(`${NAME}-cache.container`);
    await a.empfangen(update());
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    expect(Object.keys(unitDateien(a))).not.toContain(`${NAME}-cache.container`);
    expect(systemctl(a)).toContain(`stop ${UNIT_APP} ${NAME}-cache.service`);
    expect(a.record()[NAME]).toMatchObject({ pruefung: { units: [UNIT_APP] } });
  });

  it("writes the unit of a container the new version adds and starts it", async () => {
    const neu = ersetzen(
      NEU,
      "optionen:\n",
      [
        "  - name: cache",
        `    image: "localhost:5000/cache@sha256:${"c".repeat(64)}"`,
        "optionen:\n",
      ].join("\n"),
    );
    const a = await eingerichtet();
    await a.empfangen(update({ manifest: neu, signatur: signiert(neu) }));
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    expect(unitDateien(a)[`${NAME}-cache.container`]).toContain("version=2.0.0");
    expect(systemctl(a)).toContain(`restart ${UNIT_APP} ${NAME}-cache.service`);
    expect(a.record()[NAME]).toMatchObject({
      pruefung: { units: [UNIT_APP, `${NAME}-cache.service`] },
    });
  });

  it("goes from any older version, here 1.0.0 to 2.1.0", async () => {
    const neu = version("2.1.0");
    const a = await eingerichtet();
    await a.empfangen(update({ manifest: neu, signatur: signiert(neu) }));
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    expect(laufendeVersion(a)).toBe("2.1.0");
  });

  it("runs as the installation's user only, and never puts a secret into an argv, the result, the record or the log", async () => {
    const a = await eingerichtet();
    await a.empfangen(update());
    expect(updateDaten(a).ergebnis).toBe("aktualisiert");
    expect(a.seither().filter((l) => l.als !== NUTZER)).toEqual([]);
    for (const wert of [PASSWORT, GEHEIM, "streng-geheim-0815"]) {
      expect(JSON.stringify(a.sys.laeufe.map((l) => [l.argv, l.umgebung]))).not.toContain(wert);
      expect(JSON.stringify([a.gesendet, a.logs, a.record()])).not.toContain(wert);
    }
    expect(a.sys.unter(UNITS_ORDNER).length).toBeGreaterThan(0);
  });
});
