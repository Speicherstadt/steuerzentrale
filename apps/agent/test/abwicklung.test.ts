import { ABWICKLUNG_AKTIONEN, BACKUP_AKTIONEN, type BackupZugang } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import {
  einrichtenAuftrag,
  einrichtungsAgent,
  HOME,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";

/*
 * BAULISTE.md Z-604, the agent's side of the jobs after a contract (docs/plan.md, "Kündigung und
 * Löschung"), on a server in memory (testsystem.ts): `installation_loeschen` takes down an
 * installation it set up and finished, user and home included, but never without a successful
 * backup in the last two hours; `installation_archiv` runs the agent's binary as the user and
 * reports the files it uploaded. Neither takes a region where none belongs or reaches an
 * installation it does not know.
 */
const ZUGANG: BackupZugang = {
  repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
  zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: "s3-geheimnis-0815-abc" },
  passwort: "restic-passwort-der-installation",
};
const KONFIG = `${HOME}/.config/steuerzentrale`;
const JETZT = 1_800_000_000_000;

const auftrag = (aktion: string, teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({ auftragId: aktion, aktion, einrichtung: undefined, argumente: {}, ...teil });

const loeschen = () => auftrag(ABWICKLUNG_AKTIONEN.loeschen, { zeitlimitS: 600 });
const archiv = () =>
  auftrag(ABWICKLUNG_AKTIONEN.archiv, { argumente: { region: "eu-central-1" }, zeitlimitS: 600 });

const stand = (ende: number, ok: boolean) =>
  JSON.stringify({ laeufe: [{ lauf: "l-1", beginn: ende - 1000, ende, ok, teile: [] }] });

/** Set up, its backup too; `antwort` answers the user's binary `archivieren` */
const agent = async (o: { stand?: string; antwort?: string } = {}) => {
  let nachher = false;
  const a = einrichtungsAgent({
    scheitern: (l: Aufgerufen) => {
      if (!nachher || l.argv[1] !== "archivieren") return undefined;
      return o.antwort === undefined ? 1 : undefined;
    },
  });
  await a.empfangen();
  await a.empfangen(
    einrichtenAuftrag({
      auftragId: "b1",
      aktion: BACKUP_AKTIONEN.einrichten,
      einrichtung: undefined,
      backup: ZUGANG,
    }),
  );
  expect(a.ergebnis()).toMatchObject({ ok: true });
  nachher = true;
  if (o.stand !== undefined) {
    const n = a.sys.nutzer.get(NUTZER);
    a.sys.dateien.set(`${KONFIG}/backup-stand.json`, {
      art: "datei",
      inhalt: o.stand,
      modus: 0o600,
      uid: n?.uid ?? 0,
      gid: n?.gid ?? 0,
    });
  }
  return a;
};

describe("installation_loeschen", () => {
  it("takes the installation down after a backup within two hours", async () => {
    const a = await agent({ stand: stand(JETZT - 3600_000, true) });
    await a.empfangen(loeschen());
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: { installation: NAME, geaendert: "geloescht" },
    });
    expect(a.sys.nutzer.has(NUTZER)).toBe(false);
    expect(a.sys.dateien.has(HOME)).toBe(false);
    expect(a.sys.linger.has(NUTZER)).toBe(false);
    expect(a.record()).toEqual({});
  });

  it.each([
    ["no run", undefined],
    ["an old run", stand(JETZT - 3 * 3600_000, true)],
    ["a failed run", stand(JETZT - 60_000, false)],
  ])("deletes nothing after %s", async (_, s) => {
    const a = await agent(s === undefined ? {} : { stand: s });
    await a.empfangen(loeschen());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: kein gelungenes Backup von ${NAME} in den letzten zwei Stunden; gelöscht wird erst danach`,
    });
    expect(a.sys.nutzer.has(NUTZER)).toBe(true);
    expect(a.sys.laeufe.some((l) => l.argv[0] === "userdel")).toBe(false);
  });

  // review of #45: AGENTS.md, "Nie": delete a customer's data without a backup
  it("deletes nothing when the manifest has parts to back up but the backup is not set up", async () => {
    const a = einrichtungsAgent();
    await a.empfangen();
    expect(a.ergebnis()).toMatchObject({ ok: true });
    await a.empfangen(loeschen());
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringMatching(/^abgelehnt/) });
    expect(a.sys.nutzer.has(NUTZER)).toBe(true);
    expect(a.sys.laeufe.some((l) => l.argv[0] === "userdel")).toBe(false);
  });

  it("refuses an installation it does not know, and a region", async () => {
    const a = einrichtungsAgent();
    await a.empfangen(loeschen());
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringMatching(/^abgelehnt/) });
    await a.empfangen(auftrag(ABWICKLUNG_AKTIONEN.loeschen, { argumente: { region: "x" } }));
    expect(a.ergebnis()).toMatchObject({ ok: false });
    expect(a.sys.laeufe.some((l) => l.argv[0] === "userdel")).toBe(false);
  });
});

describe("installation_archiv", () => {
  it("runs archivieren as the installation's user with the region, never as root", async () => {
    const a = await agent();
    await a.empfangen(archiv());
    const lauf = a.sys.laeufe.find((l) => l.argv[1] === "archivieren");
    expect(lauf).toMatchObject({
      als: NUTZER,
      argv: ["/usr/local/bin/steuerzentrale-agent", "archivieren", NAME, "eu-central-1"],
    });
    expect(a.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringMatching(/^Archiv:/) });
    const b = await agent({ antwort: "ok" });
    await b.empfangen(archiv());
    expect(b.ergebnis()).toEqual({
      ok: true,
      daten: {
        installation: NAME,
        objekte: [{ tag: "volume:daten", datei: "volume-daten.tar", bytes: 3 }],
      },
    });
    expect(JSON.stringify([a.sys.laeufe, a.gesendet])).not.toContain(ZUGANG.zugang.geheim);
  });

  it("refuses an archive without a region or of an installation it does not know", async () => {
    const a = await agent();
    await a.empfangen(auftrag(ABWICKLUNG_AKTIONEN.archiv));
    expect(a.ergebnis()).toMatchObject({ ok: false });
    const b = einrichtungsAgent();
    await b.empfangen(archiv());
    expect(b.ergebnis()).toMatchObject({ ok: false, fehler: expect.stringMatching(/^abgelehnt/) });
  });
});
