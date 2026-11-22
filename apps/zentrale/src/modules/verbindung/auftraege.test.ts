import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { auditLog, auftraege, logAuszuege } from "../../db/schema.ts";
import { serverHinzufuegen } from "../../testhilfen/agent.ts";
import { neuerAuftrag } from "../../testhilfen/auftraege.ts";
import { testServer } from "../../testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../../testhilfen/tls.ts";
import { auftragAnlegen } from "../auftraege/index.ts";
import { serverZumFingerabdruck } from "../server/index.ts";
import { FORTSCHRITT_ABSTAND_MS } from "./auftraege.ts";
import { sitzung } from "./sitzung.ts";

/*
 * BAULISTE.md Z-305 over the agent's session: the open jobs go out right after `willkommen`, never
 * before it, and the agent's reports move them on; steps come thinned out.
 */
const aufgebaut = async () => {
  const zentrale = testServer();
  const inhaber = await zentrale.inhaber();
  const { token, serverId } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(zentrale, token);
  const gefunden = serverZumFingerabdruck(zentrale.db, await fingerabdruckVon(agent.zertifikat));
  if (!gefunden) throw new Error("not found");
  const kontext = {
    betreiberId: inhaber.betreiberId,
    akteur: inhaber.nutzerId,
    jetzt: 1,
    grund: "Test",
  };
  const anlegen = (auftragId: string, aktion = "migrieren") =>
    auftragAnlegen(zentrale.deps, kontext, neuerAuftrag(serverId, { auftragId, aktion }));
  const gesendet: Record<string, unknown>[] = [];
  const s = sitzung(zentrale.deps, gefunden);
  s.offen({ senden: (text) => gesendet.push(JSON.parse(text)), schliessen: () => {} });
  const hallo = () =>
    s.nachricht(
      JSON.stringify({
        typ: "hallo",
        protokoll: PROTOKOLL_VERSION,
        agentVersion: "0.0.0",
        architektur: "amd64",
        zeit: 1,
      }),
    );
  const melden = (n: Record<string, unknown>) =>
    s.nachricht(JSON.stringify({ protokoll: PROTOKOLL_VERSION, auftragId: "a1", ...n }));
  const zeile = () => zentrale.db.select().from(auftraege).get();
  return { zentrale, anlegen, gesendet, hallo, melden, zeile };
};

describe("jobs over the agent's session", () => {
  it("go out after willkommen, not before, and the reports move them on", async () => {
    const { zentrale, anlegen, gesendet, hallo, melden, zeile } = await aufgebaut();
    anlegen("a1");
    expect(gesendet).toEqual([]);
    await hallo();
    expect(gesendet.map((n) => [n.typ, n.auftragId])).toEqual([
      ["willkommen", undefined],
      ["auftrag", "a1"],
    ]);
    expect(zeile()?.zustand).toBe("zugestellt");
    await melden({ typ: "bestaetigt" });
    await melden({ typ: "fortschritt", schritt: "eins", zeit: 1 });
    await melden({ typ: "fortschritt", schritt: "zwei", zeit: 2 });
    expect(zeile()).toMatchObject({ zustand: "laeuft", fortschritt: "eins" });
    zentrale.stelleUhr(zentrale.jetzt() + FORTSCHRITT_ABSTAND_MS);
    await melden({ typ: "fortschritt", schritt: "drei", zeit: 3 });
    expect(zeile()?.fortschritt).toBe("drei");
    await melden({ typ: "ergebnis", zeit: 4, ergebnis: { ok: true, daten: {} } });
    expect(zeile()?.zustand).toBe("erfolgreich");
    expect(
      zentrale.db
        .select()
        .from(auditLog)
        .all()
        .filter((e) => e.ziel === "auftraege:a1")
        .map((e) => e.aktion),
    ).toEqual([
      "auftrag.anlegen",
      "auftrag.zugestellt",
      "auftrag.bestaetigt",
      "auftrag.fortschritt",
      "auftrag.ergebnis",
    ]);
  });

  it("refuse a report the job does not allow without ending the connection", async () => {
    const { zentrale, anlegen, hallo, melden, zeile } = await aufgebaut();
    await hallo();
    anlegen("a1");
    await melden({ typ: "ergebnis", zeit: 1, ergebnis: { ok: false, fehler: "x" } });
    await melden({ typ: "ergebnis", zeit: 2, ergebnis: { ok: true, daten: {} } });
    expect(zeile()?.zustand).toBe("gescheitert");
    expect(zentrale.log.some((z) => z.includes("job report refused"))).toBe(true);
  });

  // Z-405: the lines of a log excerpt are kept for a log job of this server only
  it("keep a log excerpt of a log job and drop one of another job, logging it", async () => {
    const { zentrale, anlegen, hallo, melden } = await aufgebaut();
    await hallo();
    anlegen("a1");
    anlegen("a2", "installation_log_auszug");
    await melden({ typ: "log_auszug", zeilen: ["fremd"] });
    await melden({ typ: "log_auszug", auftragId: "a2", zeilen: ["app[1]: started"] });
    expect(zentrale.db.select().from(logAuszuege).all()).toEqual([
      expect.objectContaining({ auftragId: "a2", inhalt: JSON.stringify(["app[1]: started"]) }),
    ]);
    expect(zentrale.log.filter((z) => z.includes("log excerpt dropped"))).toHaveLength(1);
  });
});
