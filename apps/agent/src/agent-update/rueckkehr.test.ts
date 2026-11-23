import { describe, expect, it } from "vitest";
import type { Spawn } from "../auftraege/ausfuehren.ts";
import { type Marke, markeLesen, markeSchreiben, updateBestaetigen } from "./marke.ts";
import { updatePruefen } from "./rueckkehr.ts";
import { BINARY, MARKE, platte } from "./testhilfen.ts";

/*
 * BAULISTE.md Z-504: a new agent that does not reach its Zentrale within the check's time is
 * replaced by the old one again; the new one confirms itself once its Zentrale greets it.
 */
const MARKIERT: Marke = {
  auftragId: "u-1",
  vorher: "0.0.0",
  neu: "0.0.1",
  am: 1,
  bestaetigt: false,
};

const umgebung = async (marke: Marke | undefined, uid = 0) => {
  const p = platte({ [BINARY]: "neu\n", [`${BINARY}.alt`]: "alt\n" });
  if (marke) await markeSchreiben(p.dateien, MARKE, marke);
  const laeufe: (readonly string[])[] = [];
  const spawn: Spawn = async (argv) => {
    laeufe.push(argv);
    return { code: 0 };
  };
  const deps = {
    dateien: p.dateien,
    binaer: p.binaer,
    binary: BINARY,
    marke: MARKE,
    spawn,
    uid: () => uid,
  };
  return { p, laeufe, deps };
};

describe("updatePruefen", () => {
  it("puts the old binary back and restarts the service when the new one did not confirm", async () => {
    const u = await umgebung(MARKIERT);
    const r = await updatePruefen(u.deps);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ vorher: "0.0.1", version: "0.0.0" });
    expect(u.p.lesen(BINARY)).toBe("alt\n");
    expect(u.p.inhalt.get(BINARY)?.modus).toBe(0o755);
    expect(u.p.inhalt.has(MARKE)).toBe(false);
    expect(u.laeufe).toEqual([
      ["systemctl", "restart", "--no-block", "steuerzentrale-agent.service"],
    ]);
  });

  it("leaves a confirmed update as it is", async () => {
    const u = await umgebung({ ...MARKIERT, bestaetigt: true });
    expect(JSON.parse((await updatePruefen(u.deps)).out).msg).toBe("agent update confirmed");
    expect(u.p.lesen(BINARY)).toBe("neu\n");
    expect(u.p.inhalt.has(MARKE)).toBe(false);
    expect(u.laeufe).toEqual([]);
  });

  it("does nothing without a mark, and nothing as another user than root", async () => {
    const ohne = await umgebung(undefined);
    expect((await updatePruefen(ohne.deps)).code).toBe(0);
    expect(ohne.p.lesen(BINARY)).toBe("neu\n");
    const nutzer = await umgebung(MARKIERT, 1000);
    expect((await updatePruefen(nutzer.deps)).code).toBe(1);
    expect(nutzer.p.lesen(BINARY)).toBe("neu\n");
    expect(nutzer.laeufe).toEqual([]);
  });
});

describe("updateBestaetigen", () => {
  const log = () => {};

  it("confirms the update to its own version at willkommen", async () => {
    const u = await umgebung(MARKIERT);
    await updateBestaetigen({ ...u.deps, pfad: MARKE, version: "0.0.1", log });
    expect(await markeLesen(u.p.dateien, MARKE)).toEqual({ ...MARKIERT, bestaetigt: true });
  });

  it("removes the mark of another version, so no check undoes the running agent", async () => {
    const u = await umgebung(MARKIERT);
    await updateBestaetigen({ ...u.deps, pfad: MARKE, version: "0.0.0", log });
    expect(u.p.inhalt.has(MARKE)).toBe(false);
  });
});
