import { describe, expect, it } from "vitest";
import { mitglieder, server as serverTabelle } from "../db/schema.ts";
import { serverHinzufuegen } from "../testhilfen/agent.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

type Person = Pick<Awaited<ReturnType<TestServer["inhaber"]>>, "json">;

/*
 * No operator sees or changes another's members and invitations (CLAUDE.md, "Project specifics": a
 * test per endpoint). In stage 1 there is one operator; the second comes in as a partner will.
 */
const zwei = async () => {
  const server = testServer();
  const teufel = await server.inhaber();
  const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  return { server, teufel, partner };
};

const einladungVon = async (person: Person) => {
  const { daten } = await person.json("/api/v1/einladungen", { body: { rolle: "inhaber" } });
  return daten as { einladungId: string; link: string };
};

describe("no operator reaches another's data", () => {
  it("GET /api/v1/ich names one's own operator", async () => {
    const { teufel, partner } = await zwei();
    expect((await teufel.json("/api/v1/ich")).daten).toMatchObject({
      betreiber: { name: "Teufel IT" },
    });
    expect((await partner.json("/api/v1/ich")).daten).toMatchObject({
      betreiber: { name: "Partner GmbH" },
    });
  });

  it("GET /api/v1/mitglieder lists one's own members only", async () => {
    const { teufel, partner } = await zwei();
    const liste = (await partner.json("/api/v1/mitglieder")).daten as {
      mitglieder: { nutzerId: string }[];
    };
    expect(liste.mitglieder.map((m) => m.nutzerId)).toEqual([partner.nutzerId]);
    expect(JSON.stringify(liste)).not.toContain(teufel.email);
  });

  it("PATCH and DELETE /api/v1/mitglieder/:nutzerId do not touch another's member", async () => {
    const { server, teufel, partner } = await zwei();
    const pfad = `/api/v1/mitglieder/${teufel.nutzerId}`;
    expect(
      (await partner.json(pfad, { method: "PATCH", body: { rolle: "mitglied" } })).status,
    ).toBe(404);
    expect((await partner.json(pfad, { method: "DELETE" })).status).toBe(404);
    expect(server.db.select().from(mitglieder).all()).toContainEqual(
      expect.objectContaining({
        betreiberId: teufel.betreiberId,
        nutzerId: teufel.nutzerId,
        rolle: "inhaber",
      }),
    );
  });

  it("GET, POST and DELETE /api/v1/einladungen stay within one's own operator", async () => {
    const { teufel, partner } = await zwei();
    const { einladungId } = await einladungVon(teufel);
    expect((await partner.json("/api/v1/einladungen")).daten).toEqual({ einladungen: [] });
    expect(
      (await partner.json(`/api/v1/einladungen/${einladungId}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await teufel.json("/api/v1/einladungen")).daten).toMatchObject({
      einladungen: [{ einladungId }],
    });
  });

  it("an accepted invitation makes a member of the inviting operator only", async () => {
    const { server, teufel, partner } = await zwei();
    const { link } = await einladungVon(partner);
    const token = link.split("#")[1] ?? "";
    const neu = server.browser();
    const { daten } = await neu.json("/api/v1/einladung/annehmen", {
      body: {
        token,
        name: "Paul",
        email: "paul@partner.test",
        passwort: "lang-genug-und-geheim-1",
      },
    });
    const { nutzerId } = daten as { nutzerId: string };
    expect(
      server.db
        .select()
        .from(mitglieder)
        .all()
        .filter((m) => m.nutzerId === nutzerId),
    ).toEqual([expect.objectContaining({ betreiberId: partner.betreiberId })]);
    expect(teufel.betreiberId).not.toBe(partner.betreiberId);
  });

  it("POST /api/v1/server adds the server to one's own operator only", async () => {
    const { server, teufel, partner } = await zwei();
    const eigener = await serverHinzufuegen(teufel);
    const fremder = await serverHinzufuegen(partner);
    const zeilen = server.db.select().from(serverTabelle).all();
    expect(zeilen.map((z) => [z.serverId, z.betreiberId]).sort()).toEqual(
      [
        [eigener.serverId, teufel.betreiberId],
        [fremder.serverId, partner.betreiberId],
      ].sort(),
    );
  });

  it("GET /api/v1/server and /api/v1/server/:serverId show one's own servers only", async () => {
    const { teufel, partner } = await zwei();
    const eigener = await serverHinzufuegen(teufel);
    await serverHinzufuegen(partner);
    const liste = (await teufel.json("/api/v1/server")).daten as { server: { serverId: string }[] };
    expect(liste.server.map((s) => s.serverId)).toEqual([eigener.serverId]);
    expect((await partner.json(`/api/v1/server/${eigener.serverId}`)).status).toBe(404);
  });

  it("POST /api/v1/server/:serverId/sperren does not revoke another's server", async () => {
    const { server, teufel, partner } = await zwei();
    const eigener = await serverHinzufuegen(teufel);
    const antwort = await partner.json(`/api/v1/server/${eigener.serverId}/sperren`, {
      body: { grund: "fremd" },
    });
    expect(antwort).toEqual({ status: 404, daten: { fehler: "kein_server" } });
    expect(server.db.select().from(serverTabelle).get()?.gesperrtAm).toBeNull();
  });
});
