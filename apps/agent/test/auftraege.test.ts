import {
  PFORTE_AKTIONEN,
  pforteGrundkonfiguration,
  schluesselLesen,
  UNBEKANNT_ID,
} from "@steuerzentrale/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { auftraege as auftragsTabelle } from "../../zentrale/src/db/schema.ts";
import {
  auftragAnlegen,
  auftragLesen,
  auftragNachricht,
} from "../../zentrale/src/modules/auftraege/index.ts";
import { serverHinzufuegen } from "../../zentrale/src/testhilfen/agent.ts";
import { neuerAuftrag } from "../../zentrale/src/testhilfen/auftraege.ts";
import { zentraleStarten } from "../../zentrale/src/testhilfen/bun-server.ts";
import { testServer } from "../../zentrale/src/testhilfen/server.ts";
import { testPforte } from "../../zentrale/src/testhilfen/testpforte.ts";
import { agentBeitreten, pforteTls } from "../../zentrale/src/testhilfen/tls.ts";
import { auftraegeAnnehmen } from "../src/auftraege/auftraege.ts";
import type { Spawn } from "../src/auftraege/ausfuehren.ts";
import { speicher, TEST_PUB } from "../src/beitritt/testhilfen.ts";
import { eingerichtet, installationenAuf } from "../src/einrichtung/testauftraege.ts";
import { testSystem } from "../src/einrichtung/testsystem.ts";
import { pfadeIn } from "../src/pfade.ts";
import { testCaddy } from "../src/pforte/testcaddy.ts";
import { echtOeffnen } from "../src/verbindung/sockel.ts";
import { verbindungsSchleife } from "../src/verbindung/verbinden.ts";

/*
 * BAULISTE.md Z-305, agent and Zentrale together, as the connection tests of Z-303: the agent's
 * real connection loop and job handling, through the stand-in for the Pforte, to the real Zentrale.
 * A job and one waiting for it run through; the second starts only after the first ended, and a
 * job sent again runs once. Podman is not here: the spawn records the argv and ends it.
 */
const aufraeumen: (() => void)[] = [];
afterEach(() => {
  for (const f of aufraeumen.splice(0).reverse()) f();
});

const aufgebaut = async () => {
  const zentrale = testServer();
  zentrale.stelleUhr(Date.now());
  const inhaber = await zentrale.inhaber();
  const { token } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(zentrale, token);
  const bun = zentraleStarten(zentrale.app);
  const tls = await pforteTls();
  const pforte = testPforte({ ziel: bun.port ?? 0, ...tls, clientCas: [agent.ca] });
  const pfade = pfadeIn("/k", "/z");
  // since Z-402 a command runs only in an installation the agent set up, as its user
  const server = testSystem({
    nutzer: [{ name: "sz-auftrag-k1", uid: 1001, gid: 1001, home: "/home/sz-auftrag-k1" }],
  });
  const fs = speicher({
    ...eingerichtet({ "auftrag-k1": "fertig" }),
    [pfade.schluessel]: agent.schluessel,
    [pfade.zertifikat]: agent.zertifikat,
  });
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const ablauf: string[] = [];
  const laeufe: (readonly string[])[] = [];
  const spawn: Spawn = async (argv) => {
    laeufe.push(argv);
    ablauf.push(`start ${argv.at(-1)}`);
    await new Promise((r) => setTimeout(r, 20));
    ablauf.push(`ende ${argv.at(-1)}`);
    return { code: 0 };
  };
  const caddy = testCaddy();
  const planen = (lauf: () => void, ms: number) => {
    const t = setTimeout(lauf, ms);
    return () => clearTimeout(t);
  };
  const log: Record<string, unknown>[] = [];
  const schleife = verbindungsSchleife(
    {
      oeffnen: echtOeffnen,
      planen,
      jetzt: Date.now,
      zufall: () => 0.5,
      log: (z) => log.push(JSON.parse(z)),
      dateien: fs.dateien,
      pfade,
      architektur: "amd64",
      serverCa: tls.ca,
      auftraege: auftraegeAnnehmen({
        dateien: fs.dateien,
        pfad: pfade.auftraege,
        vertrauen: { schluessel, zweck: "test" },
        spawn,
        pforte: { admin: caddy.admin, grund: pforteGrundkonfiguration() },
        installationen: installationenAuf(server),
        planen,
        jetzt: Date.now,
        log: () => {},
      }),
    },
    `https://127.0.0.1:${pforte.port}`,
  );
  aufraeumen.push(
    () => bun.stop(true),
    () => pforte.stoppen(),
    () => schleife.stoppen(),
  );
  await expect.poll(() => log.some((z) => z.msg === "connected"), { timeout: 5000 }).toBe(true);
  const kontext = () => ({
    betreiberId: inhaber.betreiberId,
    akteur: inhaber.nutzerId,
    jetzt: zentrale.jetzt(),
    grund: "Test",
  });
  const zustand = (id: string) => auftragLesen(zentrale.db, inhaber.betreiberId, id)?.zustand;
  return { zentrale, inhaber, agent, kontext, zustand, ablauf, laeufe, caddy };
};

describe("a job through Pforte, Zentrale and agent", () => {
  it("runs, and the one waiting for it starts only after it ended", async () => {
    const { zentrale, agent, kontext, zustand, ablauf, laeufe } = await aufgebaut();
    const erst = auftragAnlegen(
      zentrale.deps,
      kontext(),
      neuerAuftrag(agent.serverId, { auftragId: "erst" }),
    );
    const dann = auftragAnlegen(
      zentrale.deps,
      kontext(),
      neuerAuftrag(agent.serverId, {
        auftragId: "dann",
        aktion: "wiederherstellen",
        argumente: { snapshot: "a1b2c3d4" },
        wartetAuf: ["erst"],
      }),
    );
    expect(erst).toMatchObject({ ok: true, auftrag: { zustand: "zugestellt" } });
    expect(dann).toMatchObject({ ok: true, auftrag: { zustand: "wartend" } });
    await expect.poll(() => zustand("dann"), { timeout: 5000 }).toBe("erfolgreich");
    expect(zustand("erst")).toBe("erfolgreich");
    expect(ablauf).toEqual([
      "start migrieren",
      "ende migrieren",
      "start a1b2c3d4",
      "ende a1b2c3d4",
    ]);
    expect(laeufe[1]?.slice(0, 3)).toEqual(["runuser", "-u", "sz-auftrag-k1"]);
    expect(laeufe[1]?.slice(laeufe[1].indexOf("podman"))).toEqual([
      "podman",
      "exec",
      "--env",
      expect.stringMatching(/^STEUERZENTRALE_LAUF=/),
      "auftrag-k1-app",
      "bun",
      "/app/server.ts",
      "wiederherstellen",
      "a1b2c3d4",
    ]);
    const zeile = zentrale.db
      .select()
      .from(auftragsTabelle)
      .all()
      .find((a) => a.auftragId === "erst");
    expect(JSON.parse(zeile?.ergebnis ?? "{}")).toEqual({ ok: true, daten: { code: 0 } });
    expect(zeile?.fortschritt).toBe("migrieren");

    // the same job once more over the connection: answered from the agent's record, not run
    const geaendert = zeile?.geaendertAm;
    if (!zeile) throw new Error("job missing");
    expect(
      zentrale.deps.verbindungen.senden(zeile.betreiberId, zeile.serverId, auftragNachricht(zeile)),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(laeufe).toHaveLength(2);
    expect(auftragLesen(zentrale.db, zeile.betreiberId, "erst")?.geaendertAm).toBe(geaendert);
  });
});

describe("a job of the Pforte through Zentrale and agent (Z-401)", () => {
  it("is made by the Zentrale and sets the route through the admin API, no process started", async () => {
    const { zentrale, agent, kontext, zustand, laeufe, caddy } = await aufgebaut();
    const angelegt = auftragAnlegen(
      zentrale.deps,
      kontext(),
      neuerAuftrag(agent.serverId, {
        auftragId: "route",
        aktion: PFORTE_AKTIONEN.setzen,
        argumente: { host: "auftrag.kunde.example", port: 20001 },
      }),
    );
    expect(angelegt).toMatchObject({ ok: true, auftrag: { zeitlimitS: 60 } });
    await expect.poll(() => zustand("route"), { timeout: 5000 }).toBe("erfolgreich");
    expect(caddy.routen()).toEqual(["auftrag-k1", UNBEKANNT_ID]);
    expect(laeufe).toEqual([]);
  });
});
