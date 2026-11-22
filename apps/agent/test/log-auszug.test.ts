import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  eingerichtet,
  einrichtungsAgent,
  HOME,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";
import {
  AUTO,
  aktionsAuftrag,
  aktionsEinrichtung,
  aktionsManifest,
  PASSWORT,
} from "./aktionen-hilfen.ts";

/*
 * BAULISTE.md Z-405, the agent's side of the log excerpt (docs/plan.md, "Log-Auszug"): only when
 * the manifest offers it and only for an installation this agent set up and finished; the last 500
 * lines of its user's journal, read as root with a fixed argv; the value of every Podman secret and
 * of every setting of typ geheim or ebene auto in Environment= replaced by [geheim]; sent as
 * `log_auszug` before a result that tells only the number of lines; no value in an argv, a result,
 * the record or the agent's own log. On a server in memory (testsystem.ts).
 */

const UNIT = `${HOME}/.config/containers/systemd/${NAME}-app.container`;

const zeile = (text: string) => `2026-11-22T12:00:00+0000 server beispiel[42]: ${text}`;

/** A server with the installation set up by a job, its journal written, and the agent */
const eingerichteterAgent = async (
  scheitern?: (l: Aufgerufen) => number | undefined,
  manifest = aktionsManifest(),
) => {
  let nachher = false;
  const a = einrichtungsAgent({ scheitern: (l) => (nachher ? scheitern?.(l) : undefined) });
  await a.empfangen(aktionsEinrichtung(manifest));
  expect(a.ergebnis()).toMatchObject({ ok: true });
  nachher = true;
  const uid = String(a.sys.nutzer.get(NUTZER)?.uid);
  const vorher = a.sys.laeufe.length;
  const seither = () => a.sys.laeufe.slice(vorher);
  return { ...a, uid, seither };
};

/** No value of a secret anywhere the agent wrote or ran */
const nirgends = (a: Awaited<ReturnType<typeof eingerichteterAgent>>) => {
  const ueberall = JSON.stringify([
    a.gesendet,
    a.logs,
    a.record(),
    a.sys.laeufe.map((l) => [l.argv, l.umgebung]),
  ]);
  for (const wert of [AUTO, PASSWORT]) expect(ueberall).not.toContain(wert);
};

describe("a log excerpt of an installation", () => {
  it("reads the last 500 lines as root and sends them with the values replaced", async () => {
    const a = await eingerichteterAgent();
    a.sys.journal.set(
      a.uid,
      [
        zeile("listening"),
        zeile(`schluessel=${AUTO} passwort=${PASSWORT}`),
        zeile(`url=postgres://u:${PASSWORT}@db/${AUTO}`),
        "",
      ].join("\n"),
    );
    await a.empfangen(aktionsAuftrag("log_auszug"));
    expect(a.seither().filter((l) => l.argv[0] === "journalctl")).toEqual([
      {
        als: "root",
        argv: ["journalctl", `_UID=${a.uid}`, "-n", "500", "-o", "short-iso", "--no-pager"],
        umgebung: [],
        gelesen: true,
      },
    ]);
    const [auszug, ergebnis] = a.gesendet.slice(-2);
    expect(auszug).toEqual({
      typ: "log_auszug",
      protokoll: 1,
      auftragId: "log_auszug-1",
      zeilen: [
        zeile("listening"),
        zeile("schluessel=[geheim] passwort=[geheim]"),
        zeile("url=postgres://u:[geheim]@db/[geheim]"),
      ],
    });
    expect(ergebnis).toMatchObject({
      typ: "ergebnis",
      auftragId: "log_auszug-1",
      ergebnis: { ok: true, daten: { zeilen: 3 } },
    });
    nirgends(a);
  });

  it("replaces values side by side as one, and cuts each line to 2000 characters", async () => {
    // overlapping values and one inside another: schwaerzen.test.ts
    const a = await eingerichteterAgent();
    a.sys.journal.set(
      a.uid,
      `${zeile(`x${PASSWORT}${AUTO}y`)}\n${zeile(`${"a".repeat(2100)}${PASSWORT}`)}\n`,
    );
    await a.empfangen(aktionsAuftrag("log_auszug"));
    const auszug = a.gesendet.at(-2) as { zeilen: string[] };
    expect(auszug.zeilen[0]).toBe(zeile("x[geheim]y"));
    expect(auszug.zeilen[1]).toHaveLength(2000);
    nirgends(a);
  });

  it("is refused when the manifest does not offer it, before anything runs", async () => {
    const a = await eingerichteterAgent();
    const ohne = aktionsManifest(
      "{ nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt, log_auszug: { nicht_unterstuetzt: Datenschutz } }",
    );
    await a.empfangen(aktionsAuftrag("log_auszug", {}, ohne));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: the manifest does not offer log_auszug",
    });
    expect(a.seither()).toEqual([]);
    expect(a.gesendet.some((g) => g.typ === "log_auszug")).toBe(false);
  });

  it("is refused with the manifest of another app than the installation's", async () => {
    // the installation's own manifest does not offer the log excerpt; a job may not lend it another
    const ohne = aktionsManifest(
      "{ nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt, log_auszug: { nicht_unterstuetzt: Datenschutz } }",
    );
    const a = await eingerichteterAgent(undefined, ohne);
    a.sys.journal.set(a.uid, `${zeile("kundendaten")}\n`);
    const fremd = aktionsManifest().replace("id: beispiel", "id: anderes");
    await a.empfangen(aktionsAuftrag("log_auszug", {}, fremd));
    expect(a.ergebnis()).toMatchObject({ ok: false });
    expect(a.seither().some((l) => l.argv[0] === "journalctl")).toBe(false);
    expect(a.gesendet.some((g) => g.typ === "log_auszug")).toBe(false);
  });

  it("replaces the rest of a value at the start of an entry that continues a split line", async () => {
    // conmon writes a line longer than its buffer of 8192 bytes as several entries (STDIO_BUF_SIZE,
    // CONTAINER_PARTIAL_MESSAGE in src/ctr_logging.c of containers/conmon): a value can be cut in
    // two, its first part at the end of one entry, the rest at the start of the next
    const a = await eingerichteterAgent();
    const teil = 8;
    a.sys.journal.set(
      a.uid,
      [
        zeile(`{"config":"${"x".repeat(8150)}${AUTO.slice(0, teil)}`),
        zeile(`${AUTO.slice(teil)}","ende":1}`),
        "",
      ].join("\n"),
    );
    await a.empfangen(aktionsAuftrag("log_auszug"));
    const auszug = a.gesendet.at(-2) as { zeilen: string[] };
    expect(auszug.zeilen[1]).toBe(zeile('[geheim]","ende":1}'));
    expect(JSON.stringify(auszug)).not.toContain(AUTO.slice(teil));
  });

  it("is refused for an installation this agent did not set up and finish", async () => {
    for (const anfang of [{}, eingerichtet({ [NAME]: "angelegt" })]) {
      const a = einrichtungsAgent({ anfang });
      await a.empfangen(aktionsAuftrag("log_auszug"));
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
      });
      expect(a.sys.laeufe).toEqual([]);
    }
  });

  it("is refused for an entry from before Z-403, whose units the record does not know", async () => {
    const a = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "fertig" }) });
    await a.empfangen(aktionsAuftrag("log_auszug"));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: das Gedächtnis kennt die Units von ${NAME} nicht (vor Z-403)`,
    });
  });

  it("takes the names of an entry from before Z-405 from the manifest the units were made of", async () => {
    const a = await eingerichteterAgent();
    const record = JSON.parse(a.fs.inhalt.get("/z/installationen.json")?.text ?? "");
    delete record.installationen[NAME].geheim;
    a.fs.inhalt.set("/z/installationen.json", { text: JSON.stringify(record), modus: 0o600 });
    const b = einrichtungsAgent({}, a.fs, a.sys);
    a.sys.journal.set(a.uid, `${zeile(`k=${AUTO}`)}\n`);
    await b.empfangen(aktionsAuftrag("log_auszug"));
    expect((b.gesendet.at(-2) as { zeilen: string[] }).zeilen).toEqual([zeile("k=[geheim]")]);
    // another version of the app: its names need not be those of the units
    await b.empfangen(
      aktionsAuftrag("log_auszug", { auftragId: "l2" }, aktionsManifest(undefined, "1.0.1")),
    );
    expect(b.ergebnis()).toEqual({
      ok: false,
      fehler:
        "abgelehnt: das Gedächtnis kennt die geheimen Einstellungen nicht (vor Z-405), und die Units sind nicht aus dem Manifest des Auftrags",
    });
  });

  it("reads nothing of the journal when the secrets or the units cannot be read", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[2] === "inspect" ? 125 : undefined));
    await a.empfangen(aktionsAuftrag("log_auszug"));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler:
        "abgelehnt: die Secrets sind nicht lesbar (podman secret inspect: endete mit Code 125)",
    });
    expect(a.seither().some((l) => l.argv[0] === "journalctl")).toBe(false);
    const b = await eingerichteterAgent();
    b.sys.dateien.delete(UNIT);
    await b.empfangen(aktionsAuftrag("log_auszug"));
    expect(b.ergebnis()).toEqual({ ok: false, fehler: `abgelehnt: ${UNIT} fehlt` });
    expect(b.seither().some((l) => l.argv[0] === "journalctl")).toBe(false);
  });

  it("reports a journalctl that fails, without lines", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[0] === "journalctl" ? 1 : undefined));
    await a.empfangen(aktionsAuftrag("log_auszug"));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "Log-Auszug gescheitert: journalctl endete mit Code 1",
    });
    expect(a.gesendet.some((g) => g.typ === "log_auszug")).toBe(false);
  });

  it("waits for a reconfiguring of the installation before it reads its secrets", async () => {
    const a = await eingerichteterAgent();
    a.sys.journal.set(a.uid, `${zeile(`pw=${PASSWORT}`)}\n`);
    const manifest = aktionsManifest();
    const konfigurieren = a.empfangen({
      ...aktionsEinrichtung(manifest),
      auftragId: "k1",
      aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
    });
    const auszug = a.empfangen(aktionsAuftrag("log_auszug"));
    await Promise.all([konfigurieren, auszug]);
    const programme = a.seither().map((l) => l.argv.slice(0, 3).join(" "));
    const letzterNeustart = programme.lastIndexOf("systemctl --user restart");
    const gelesen = programme.lastIndexOf("podman secret ls");
    expect(letzterNeustart).toBeGreaterThan(-1);
    expect(gelesen).toBeGreaterThan(letzterNeustart);
    expect((a.gesendet.find((g) => g.typ === "log_auszug") as { zeilen: string[] }).zeilen).toEqual(
      [zeile("pw=[geheim]")],
    );
  });
});
