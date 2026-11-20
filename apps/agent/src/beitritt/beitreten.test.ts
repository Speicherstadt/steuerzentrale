import { BeitrittAnfrage } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { pfadeIn } from "../pfade.ts";
import { type Auftrag, beitreten } from "./beitreten.ts";
import { speicher, TEST_PUB } from "./testhilfen.ts";

const PEM = (art: string) => `-----BEGIN ${art}-----\nAAAA\n-----END ${art}-----\n`;
const pfade = pfadeIn("/k", "/z");
const AUFTRAG: Auftrag = {
  zentrale: "http://10.0.0.1:28300",
  token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  testmodus: true,
};

/** A Zentrale that answers the exchange with `antwort`, and what it was sent */
const zentrale = (antwort: () => Response) => {
  const anfragen: { url: string; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    anfragen.push({ url, body: JSON.parse(String(init.body)) });
    return antwort();
  };
  return { fetch, anfragen };
};

const ausgestellt = () =>
  Response.json(
    { serverId: "srv-1", zertifikat: PEM("CERTIFICATE"), ca: PEM("CERTIFICATE"), gueltigBis: 1 },
    { status: 201 },
  );

const lauf = (antwort: () => Response, auftrag = AUFTRAG, pub = TEST_PUB) => {
  const fs = speicher({ "/k/manifest.pub": pub });
  const z = zentrale(antwort);
  const ergebnis = beitreten(
    { fetch: z.fetch, dateien: fs.dateien, pfade, architektur: "amd64" },
    auftrag,
  );
  return { ergebnis, fs, z };
};

describe("joining the Zentrale", () => {
  it("sends token and request, and keeps key, certificate, CA and settings", async () => {
    const { ergebnis, fs, z } = lauf(ausgestellt);
    expect(await ergebnis).toEqual({ ok: true, wert: "srv-1" });
    expect(z.anfragen[0]?.url).toBe("http://10.0.0.1:28300/api/v1/agent/beitreten");
    const gesendet = BeitrittAnfrage.parse(z.anfragen[0]?.body);
    expect(gesendet).toMatchObject({ token: AUFTRAG.token, architektur: "amd64" });
    expect(fs.inhalt.get("/z/agent.key")?.modus).toBe(0o600);
    expect(fs.inhalt.get("/z/agent.key")?.text).toContain("BEGIN PRIVATE KEY");
    expect(fs.inhalt.get("/z/agent.pem")?.text).toBe(PEM("CERTIFICATE"));
    expect(fs.inhalt.get("/z/ca.pem")?.text).toBe(PEM("CERTIFICATE"));
    expect(JSON.parse(fs.inhalt.get("/k/agent.json")?.text ?? "")).toEqual({
      zentrale: "http://10.0.0.1:28300",
      serverId: "srv-1",
      testmodus: true,
    });
    // the private key never travels: only the request does
    expect(JSON.stringify(z.anfragen)).not.toContain("PRIVATE KEY");
    // the key is kept before the token is used up
    expect(fs.reihenfolge[0]).toBe("/z/agent.key");
  });

  it("keeps no certificate when the Zentrale refuses the token", async () => {
    const { ergebnis, fs } = lauf(() =>
      Response.json({ fehler: "token_ungueltig" }, { status: 401 }),
    );
    expect(await ergebnis).toEqual({
      ok: false,
      grund: "the Zentrale refused the join: 401 token_ungueltig",
    });
    expect(fs.inhalt.has("/z/agent.pem")).toBe(false);
    expect(fs.inhalt.has("/k/agent.json")).toBe(false);
  });

  it("refuses an answer that is no certificate", async () => {
    const { ergebnis, fs } = lauf(() => Response.json({ serverId: "x" }, { status: 201 }));
    expect((await ergebnis).ok).toBe(false);
    expect(fs.inhalt.has("/z/agent.pem")).toBe(false);
  });

  it("speaks plain HTTP only in test mode", async () => {
    const { ergebnis, z } = lauf(ausgestellt, { ...AUFTRAG, testmodus: false });
    expect(await ergebnis).toEqual({ ok: false, grund: "the Zentrale is reached over https only" });
    expect(z.anfragen).toEqual([]);
  });

  it("refuses the public test key outside test mode (docs/plan.md, Signaturen in Tests)", async () => {
    const { ergebnis, z } = lauf(ausgestellt, {
      ...AUFTRAG,
      zentrale: "https://agent.example.de",
      testmodus: false,
    });
    const r = await ergebnis;
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.grund).toContain("public test key");
    expect(z.anfragen).toEqual([]);
  });

  it("does not join twice, keeping the key its certificate belongs to", async () => {
    const fs = speicher({ "/k/manifest.pub": TEST_PUB });
    const z = zentrale(ausgestellt);
    const deps = { fetch: z.fetch, dateien: fs.dateien, pfade, architektur: "amd64" as const };
    expect((await beitreten(deps, AUFTRAG)).ok).toBe(true);
    const schluessel = fs.inhalt.get("/z/agent.key")?.text;
    expect(await beitreten(deps, AUFTRAG)).toEqual({
      ok: false,
      grund: "the server has joined already",
    });
    expect(fs.inhalt.get("/z/agent.key")?.text).toBe(schluessel);
    expect(z.anfragen).toHaveLength(1);
  });

  it("refuses to join without a manifest key", async () => {
    const { ergebnis, z } = lauf(ausgestellt, AUFTRAG, "kein schluessel");
    expect((await ergebnis).ok).toBe(false);
    expect(z.anfragen).toEqual([]);
  });
});
