import * as x509 from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import { auditLog, geheimnisse, server as serverTabelle, tokens } from "../db/schema.ts";
import { BEITRITT_GUELTIG_MS } from "../modules/server/index.ts";
import { serverHinzufuegen, testAnfrage } from "../testhilfen/agent.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";
import { BEITRITT_GRENZE } from "./agent.ts";

/*
 * BAULISTE.md Z-302: the agent exchanges the one-time token for its client certificate. A used or
 * expired token is refused, the certificate comes from the operator's CA, and the Zentrale keeps only
 * its fingerprint.
 */
const PFAD = "/api/v1/agent/beitreten";

const vorbereitet = async () => {
  const server = testServer();
  const inhaber = await server.inhaber();
  const neu = await serverHinzufuegen(inhaber);
  return { server, inhaber, ...neu };
};

const tauschen = async (server: TestServer, body: unknown, adresse?: string) =>
  server.browser(adresse).json(PFAD, { body });

type Antwort = { serverId: string; zertifikat: string; ca: string; gueltigBis: number };

describe("the token exchange", () => {
  it("issues a client certificate from the operator's CA and keeps only its fingerprint", async () => {
    const { server, serverId, token } = await vorbereitet();
    const { status, daten } = await tauschen(server, await testAnfrage(token));
    expect(status).toBe(201);
    const antwort = daten as Antwort;
    const zertifikat = new x509.X509Certificate(antwort.zertifikat);
    const ca = new x509.X509Certificate(antwort.ca);
    expect(antwort.serverId).toBe(serverId);
    expect(zertifikat.subject).toBe(`CN=${serverId}`);
    expect(await zertifikat.verify({ publicKey: ca.publicKey, signatureOnly: true })).toBe(true);
    expect(zertifikat.notBefore.getTime()).toBe(server.jetzt());
    expect(zertifikat.notAfter.getTime()).toBe(antwort.gueltigBis);
    const nutzung = zertifikat.getExtension(x509.ExtendedKeyUsageExtension);
    expect(nutzung?.usages).toEqual([x509.ExtendedKeyUsage.clientAuth]);
    expect(zertifikat.getExtension(x509.BasicConstraintsExtension)?.ca).toBe(false);
    const fingerabdruck = Buffer.from(await zertifikat.getThumbprint("SHA-256")).toString("hex");
    const zeile = server.db.select().from(serverTabelle).get();
    expect(zeile).toMatchObject({
      fingerabdruck,
      zertifikatGueltigBis: antwort.gueltigBis,
      beigetretenAm: server.jetzt(),
      architektur: "amd64",
    });
    expect(JSON.stringify(server.db.select().from(serverTabelle).all())).not.toContain("BEGIN");
    expect(
      server.db
        .select()
        .from(tokens)
        .all()
        .filter((t) => t.tokenId === serverId),
    ).toEqual([]);
  });

  it("refuses a token that was used", async () => {
    const { server, token } = await vorbereitet();
    expect((await tauschen(server, await testAnfrage(token))).status).toBe(201);
    const zweiter = await tauschen(server, await testAnfrage(token));
    expect(zweiter).toEqual({ status: 401, daten: { fehler: "token_ungueltig" } });
  });

  it("refuses a token after 24 hours", async () => {
    const { server, token } = await vorbereitet();
    server.stelleUhr(server.jetzt() + BEITRITT_GUELTIG_MS);
    const { status, daten } = await tauschen(server, await testAnfrage(token));
    expect({ status, daten }).toEqual({ status: 401, daten: { fehler: "token_ungueltig" } });
    expect(server.db.select().from(serverTabelle).get()?.fingerabdruck).toBeNull();
  });

  it("refuses a token that never was", async () => {
    const { server } = await vorbereitet();
    const { status } = await tauschen(server, await testAnfrage("x".repeat(43)));
    expect(status).toBe(401);
  });

  it("lets only one of two exchanges with the same token through", async () => {
    const { server, token } = await vorbereitet();
    const [a, b] = await Promise.all([
      tauschen(server, await testAnfrage(token)),
      tauschen(server, await testAnfrage(token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 401]);
  });

  it("refuses a request whose signature does not hold or that is no P-256 key, keeping the token", async () => {
    const { server, token } = await vorbereitet();
    const echt = await testAnfrage(token);
    const pem = echt.csr.split("\n");
    // a character inside the signature, near the end of the base64
    const zeile = pem.length - 3;
    pem[zeile] = (pem[zeile] ?? "").replace(/^./, (z) => (z === "A" ? "B" : "A"));
    const gefaelscht = { ...echt, csr: pem.join("\n") };
    expect((await tauschen(server, gefaelscht)).daten).toEqual({ fehler: "anfrage_ungueltig" });
    const rsa = await testAnfrage(token, {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    });
    expect((await tauschen(server, rsa)).daten).toEqual({ fehler: "anfrage_ungueltig" });
    expect((await tauschen(server, await testAnfrage(token))).status).toBe(201);
  });

  it("refuses what is no join request", async () => {
    const { server, token } = await vorbereitet();
    for (const body of [{}, { token }, { ...(await testAnfrage(token)), shell: "id" }])
      expect((await tauschen(server, body)).status).toBe(400);
  });

  it("limits the attempts per address", async () => {
    const { server } = await vorbereitet();
    const falsch = await testAnfrage("y".repeat(43));
    for (let i = 0; i < BEITRITT_GRENZE; i++)
      expect((await tauschen(server, falsch, "198.51.100.7")).status).toBe(401);
    expect(await tauschen(server, falsch, "198.51.100.7")).toEqual({
      status: 429,
      daten: { fehler: "zu_viele_versuche" },
    });
    // another address has its own count
    expect((await tauschen(server, falsch, "198.51.100.8")).status).toBe(401);
  });

  it("counts the addresses of one IPv6 network together", async () => {
    const { server } = await vorbereitet();
    const falsch = await testAnfrage("y".repeat(43));
    for (let i = 0; i < BEITRITT_GRENZE; i++)
      expect((await tauschen(server, falsch, `2001:db8:7:7::${i + 1}`)).status).toBe(401);
    expect((await tauschen(server, falsch, "2001:db8:7:7:ffff::1")).status).toBe(429);
    expect((await tauschen(server, falsch, "2001:db8:7:8::1")).status).toBe(401);
  });

  it("counts the client behind the Pforte, and a client's own forwarding header not at all", async () => {
    const { server } = await vorbereitet();
    const falsch = await testAnfrage("y".repeat(43));
    const ueber = (adresse: string, weitergeleitet: string) =>
      server
        .browser(adresse)
        .json(PFAD, { body: falsch, headers: { "x-forwarded-for": weitergeleitet } });
    for (let i = 0; i < BEITRITT_GRENZE; i++)
      expect((await ueber("198.51.100.9", `192.0.2.${i}`)).status).toBe(401);
    // another header did not make another client: still 198.51.100.9
    expect((await ueber("198.51.100.9", "192.0.2.200")).status).toBe(429);
    // behind the Pforte each client has its own count, however many came before
    for (let i = 0; i < BEITRITT_GRENZE; i++)
      expect((await ueber("127.0.0.1", "203.0.113.1")).status).toBe(401);
    expect((await ueber("127.0.0.1", "203.0.113.1")).status).toBe(429);
    expect((await ueber("127.0.0.1", "203.0.113.2")).status).toBe(401);
  });

  it("keeps the CA's key encrypted and records it in the audit log only as changed", async () => {
    const { server, token } = await vorbereitet();
    await tauschen(server, await testAnfrage(token));
    const ca = server.db.select().from(geheimnisse).all();
    expect(ca.map((g) => g.geheimnisId)).toEqual(["agent-ca"]);
    const alles = JSON.stringify([ca, server.db.select().from(auditLog).all()]);
    expect(alles).not.toContain("BEGIN");
    expect(alles).not.toContain(`"schluessel"`);
  });

  it("issues every server of an operator from the same CA, and another operator's from its own", async () => {
    const { server, inhaber, token } = await vorbereitet();
    const zweiter = await serverHinzufuegen(inhaber, {
      name: "Zweiter",
      wartungsfenster: { tage: [1], von: "02:00", bis: "03:00" },
      grund: "noch einer",
    });
    const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
    const fremd = await serverHinzufuegen(partner);
    const ca = async (t: string) =>
      ((await tauschen(server, await testAnfrage(t))).daten as Antwort).ca;
    const [a, b, c] = [await ca(token), await ca(zweiter.token), await ca(fremd.token)];
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(new x509.X509Certificate(c).subject).toContain(partner.betreiberId);
  });
});
