import { describe, expect, it } from "vitest";
import {
  EINRICHTUNG,
  eingerichtet,
  einrichtenAuftrag,
  einrichtungsAgent,
  entfernenAuftrag,
  HOME,
  IMAGE,
  NAME,
  NUTZER,
} from "./testauftraege.ts";
import { type Aufgerufen, PFORTE } from "./testsystem.ts";

/*
 * BAULISTE.md Z-402, the agent's side (docs/plan.md, "Scheitern beim Einrichten", "Gedächtnis der
 * Installationen"): any failing step tears everything down before the result; a user it did not
 * make the agent never touches; a job sent twice, or again after a restart, sets up once; removing
 * is only for a setup that did not finish; without its record of installations it does nothing.
 * On a server in memory (testsystem.ts).
 */

const UNITS = [`${NAME}-app.service`];

const FEHLSCHRITTE: [string, (l: Aufgerufen) => boolean][] = [
  ["useradd", (l) => l.argv[0] === "useradd"],
  ["loginctl enable-linger", (l) => l.argv[1] === "enable-linger"],
  [`podman secret create ${NAME}-beispiel-schluessel`, (l) => l.argv[1] === "secret"],
  [`podman pull ${IMAGE}`, (l) => l.argv[1] === "pull"],
  ["systemctl --user daemon-reload", (l) => l.als === NUTZER && l.argv[2] === "daemon-reload"],
  ["systemctl --user start", (l) => l.als === NUTZER && l.argv[2] === "start"],
  ["schritte.einrichten migrieren", (l) => l.argv[1] === "exec"],
];

describe("a failing step", () => {
  const nichtsUebrig = (a: ReturnType<typeof einrichtungsAgent>) => {
    expect(a.sys.nutzer.has(NUTZER)).toBe(false);
    expect(a.sys.dateien.has(HOME)).toBe(false);
    expect(a.sys.linger.has(NUTZER)).toBe(false);
    expect(a.sys.secrets.has(NUTZER)).toBe(false);
    expect(a.sys.aktiv.get(NUTZER) ?? new Set()).toEqual(new Set());
    expect(a.record()).toEqual({});
  };

  it.each(FEHLSCHRITTE)(
    "%s: everything is torn down before the result",
    async (schritt, trifft) => {
      const a = einrichtungsAgent({ scheitern: (l) => (trifft(l) ? 7 : undefined) });
      await a.empfangen();
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `Einrichten gescheitert: ${schritt}: endete mit Code 7; alles abgebaut`,
      });
      nichtsUebrig(a);
    },
  );

  it("units that never become active: torn down", async () => {
    const a = einrichtungsAgent({ scheitern: (l) => (l.argv[2] === "is-active" ? 3 : undefined) });
    await a.empfangen();
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Einrichten gescheitert: units not active: ${UNITS.join(", ")}; alles abgebaut`,
    });
    nichtsUebrig(a);
  });

  it("a user without subordinate ids, which rootless Podman needs: torn down", async () => {
    const a = einrichtungsAgent({ ohneSubuid: true });
    await a.empfangen();
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Einrichten gescheitert: useradd: ${NUTZER} has no subordinate ids in /etc/subuid; alles abgebaut`,
    });
    nichtsUebrig(a);
  });

  it("a user manager that never comes up: torn down", async () => {
    const a = einrichtungsAgent({ ohneBus: true });
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({
      ok: false,
      fehler: expect.stringContaining("did not start"),
    });
    nichtsUebrig(a);
  });

  it("writing a unit: torn down", async () => {
    const a = einrichtungsAgent({
      schreibenScheitert: (p) => p.endsWith(".container") && p.startsWith(HOME),
    });
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringContaining("EIO") });
    nichtsUebrig(a);
  });

  it("the job's time limit: the step is killed and everything torn down", async () => {
    const a = einrichtungsAgent({ haengt: (l) => l.argv[1] === "pull" });
    const fertig = a.empfangen();
    await new Promise((r) => setTimeout(r, 0));
    await expect.poll(() => a.programme().at(-1)).toBe(`${NUTZER}: podman pull`);
    a.plaene.find((p) => p.ms === 1_800_000)?.lauf();
    await fertig;
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Einrichten gescheitert: podman pull ${IMAGE}: Zeitlimit des Auftrags überschritten; alles abgebaut`,
    });
    nichtsUebrig(a);
  });

  it("stops the units, ends lingering and the user's processes, then removes user and home", async () => {
    const a = einrichtungsAgent({ scheitern: (l) => (l.argv[1] === "exec" ? 1 : undefined) });
    await a.empfangen();
    const abbau = a.sys.laeufe.slice(a.sys.laeufe.findIndex((l) => l.argv[1] === "exec") + 1);
    expect(abbau.map((l) => [l.als, ...l.argv])).toEqual([
      [NUTZER, "systemctl", "--user", "stop", ...UNITS],
      ["root", "loginctl", "disable-linger", NUTZER],
      ["root", "loginctl", "terminate-user", NUTZER],
      ["root", "userdel", "--remove", NUTZER],
    ]);
  });

  it("when tearing down fails too, says so and keeps the installation for removing", async () => {
    let userdelGeht = false;
    const a = einrichtungsAgent({
      scheitern: (l) => {
        if (l.argv[1] === "exec") return 1;
        if (l.argv[0] === "userdel" && !userdelGeht) return 8;
        return undefined;
      },
    });
    await a.empfangen();
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: expect.stringMatching(/Abbau unvollständig: userdel: endete mit Code 8$/),
    });
    expect(a.record()).toEqual({ [NAME]: { zustand: "angelegt", am: expect.any(Number) } });
    userdelGeht = true;
    await a.empfangen(entfernenAuftrag());
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: { installation: NAME, geaendert: "entfernt" },
    });
    nichtsUebrig(a);
  });
});

describe("a user the agent did not make", () => {
  const FREMD = { name: NUTZER, uid: 3000, gid: 3000, home: HOME };

  it("is never set up over", async () => {
    const a = einrichtungsAgent({ nutzer: [PFORTE, FREMD] });
    await a.empfangen();
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NUTZER} gibt es schon, nicht von diesem Agenten angelegt`,
    });
    expect(a.sys.laeufe).toEqual([]);
    expect(a.sys.nutzer.get(NUTZER)).toEqual(FREMD);
  });

  it("nor a home of that name without a user", async () => {
    const a = einrichtungsAgent();
    a.sys.dateien.set(HOME, { art: "verzeichnis", modus: 0o755, uid: 0, gid: 0 });
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({
      ok: false,
      fehler: expect.stringContaining(`abgelehnt: ${HOME}`),
    });
    expect(a.sys.laeufe).toEqual([]);
  });

  it("is never removed", async () => {
    const a = einrichtungsAgent({ nutzer: [PFORTE, FREMD] });
    await a.empfangen(entfernenAuftrag());
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringContaining("abgelehnt") });
    expect(a.sys.laeufe).toEqual([]);
    expect(a.sys.nutzer.get(NUTZER)).toEqual(FREMD);
  });

  it("does not have commands run as it", async () => {
    const a = einrichtungsAgent({ nutzer: [PFORTE, FREMD] });
    await a.empfangen(einrichtenAuftrag({ aktion: "migrieren", einrichtung: undefined }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} is no installation this agent set up`,
    });
    expect(a.sys.laeufe).toEqual([]);
  });
});

describe("a setup job sent twice", () => {
  const useradds = (a: ReturnType<typeof einrichtungsAgent>) =>
    a.sys.laeufe.filter((l) => l.argv[0] === "useradd").length;

  it("with the same id sets up once and sends the stored result", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    await a.empfangen();
    expect(useradds(a)).toBe(1);
    expect(a.gesendet.at(-1)).toMatchObject({ typ: "ergebnis", ergebnis: { ok: true } });
  });

  it("as a new job for the same installation changes nothing", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const vorher = a.sys.laeufe.length;
    await a.empfangen(einrichtenAuftrag({ auftragId: "e2" }));
    expect(a.ergebnis()).toEqual({ ok: true, daten: { installation: NAME, geaendert: "nichts" } });
    expect(a.sys.laeufe).toHaveLength(vorher);
  });

  it("while the first still runs sets up once", async () => {
    const a = einrichtungsAgent();
    await Promise.all([a.empfangen(), a.empfangen(einrichtenAuftrag({ auftragId: "e2" }))]);
    expect(useradds(a)).toBe(1);
    expect(a.record()).toEqual({ [NAME]: { zustand: "fertig", am: expect.any(Number) } });
  });

  it("after a restart in the middle tears the half one down and sets up once", async () => {
    let abgestuerzt = false;
    const vorher = einrichtungsAgent({ haengt: (l) => !abgestuerzt && l.argv[1] === "pull" });
    void vorher.empfangen();
    await expect.poll(() => vorher.programme().at(-1)).toBe(`${NUTZER}: podman pull`);
    expect(vorher.record()).toEqual({ [NAME]: { zustand: "angelegt", am: expect.any(Number) } });
    // the agent's process is gone; the server and its files stay, the Zentrale sends the job again
    const sys = vorher.sys;
    abgestuerzt = true;
    const nachher = einrichtungsAgent({}, vorher.fs, sys);
    const bis = sys.laeufe.length;
    await nachher.empfangen();
    expect(nachher.ergebnis()).toMatchObject({ ok: true, daten: { geaendert: "neu" } });
    const danach = sys.laeufe.slice(bis).map((l) => l.argv[0]);
    expect(danach.indexOf("userdel")).toBeLessThan(danach.indexOf("useradd"));
    expect(danach.filter((p) => p === "useradd")).toHaveLength(1);
    expect(nachher.record()).toEqual({ [NAME]: { zustand: "fertig", am: expect.any(Number) } });
  });
});

describe("removing an installation", () => {
  it("is refused for one that is set up: its data goes only with a backup (Z-604)", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    const vorher = a.sys.laeufe.length;
    await a.empfangen(entfernenAuftrag());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} ist fertig eingerichtet; entfernt wird sie erst mit Backup (Z-604)`,
    });
    expect(a.sys.laeufe).toHaveLength(vorher);
    expect(a.sys.nutzer.has(NUTZER)).toBe(true);
  });

  it("tears down one whose setup did not finish", async () => {
    const a = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "angelegt" }) });
    a.sys.nutzer.set(NUTZER, { name: NUTZER, uid: 2500, gid: 2500, home: HOME });
    a.sys.dateien.set(HOME, { art: "verzeichnis", modus: 0o700, uid: 2500, gid: 2500 });
    await a.empfangen(entfernenAuftrag());
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: { installation: NAME, geaendert: "entfernt" },
    });
    expect(a.sys.nutzer.has(NUTZER)).toBe(false);
    expect(a.sys.dateien.has(HOME)).toBe(false);
    expect(a.record()).toEqual({});
  });

  it("of one that is not there changes nothing", async () => {
    const a = einrichtungsAgent();
    await a.empfangen(entfernenAuftrag());
    expect(a.ergebnis()).toEqual({ ok: true, daten: { installation: NAME, geaendert: "nichts" } });
    expect(a.sys.laeufe).toEqual([]);
  });

  it("takes no installation data", async () => {
    const a = einrichtungsAgent();
    await a.empfangen(entfernenAuftrag({ einrichtung: EINRICHTUNG }));
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringContaining("abgelehnt") });
  });
});

describe("the record of installations", () => {
  it("unreadable: no setup, no removal, no command, nothing touched", async () => {
    for (const n of [
      einrichtenAuftrag(),
      entfernenAuftrag(),
      einrichtenAuftrag({ aktion: "migrieren", einrichtung: undefined }),
    ]) {
      const a = einrichtungsAgent({ anfang: { "/z/installationen.json": "kaputt" } });
      await a.empfangen(n);
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: "abgelehnt: /z/installationen.json is not the agent's record of installations",
      });
      expect(a.sys.laeufe).toEqual([]);
    }
  });

  it("is written with mode 0600", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    expect(a.fs.inhalt.get("/z/installationen.json")?.modus).toBe(0o600);
  });

  it("has the installation before its user is made", async () => {
    const a = einrichtungsAgent({
      scheitern: (l) => {
        if (l.argv[0] === "useradd")
          expect(JSON.parse(a.fs.inhalt.get("/z/installationen.json")?.text ?? "{}")).toEqual({
            installationen: { [NAME]: { zustand: "angelegt", am: expect.any(Number) } },
          });
        return undefined;
      },
    });
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({ ok: true });
  });
});
