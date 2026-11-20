import { describe, expect, it } from "vitest";
import { member } from "../db/auth-schema.ts";
import { auditLog, mitglieder } from "../db/schema.ts";
import { testServer } from "../testhilfen/server.ts";

describe("the members of an operator", () => {
  it("are listed with name, address and role", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const technik = await server.eingeladen(inhaber, "technik");
    const { status, daten } = await technik.json("/api/v1/mitglieder");
    expect(status).toBe(200);
    expect(daten).toEqual({
      mitglieder: [
        expect.objectContaining({
          nutzerId: inhaber.nutzerId,
          name: "Ines Inhaber",
          rolle: "inhaber",
        }),
        expect.objectContaining({
          nutzerId: technik.nutzerId,
          email: technik.email,
          rolle: "technik",
        }),
      ],
    });
  });

  it("change role through the owner, in Better Auth, the mirror and the audit log, at once", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const support = await server.eingeladen(inhaber, "support");
    expect((await support.anfrage("/api/v1/einladungen")).status).toBe(403);
    const geaendert = await inhaber.json(`/api/v1/mitglieder/${support.nutzerId}`, {
      method: "PATCH",
      body: { rolle: "inhaber" },
    });
    expect(geaendert).toEqual({
      status: 200,
      daten: { nutzerId: support.nutzerId, rolle: "inhaber" },
    });
    expect((await support.anfrage("/api/v1/einladungen")).status).toBe(200);
    expect(server.db.select().from(member).all()).toContainEqual(
      expect.objectContaining({ userId: support.nutzerId, role: "inhaber" }),
    );
    expect(server.db.select().from(auditLog).all().at(-1)).toMatchObject({
      aktion: "mitglied.rolle",
      akteur: inhaber.nutzerId,
      ziel: `mitglieder:${support.nutzerId}`,
    });
  });

  it("keep their last owner: neither demoted nor removed", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const pfad = `/api/v1/mitglieder/${inhaber.nutzerId}`;
    expect(await inhaber.json(pfad, { method: "PATCH", body: { rolle: "technik" } })).toEqual({
      status: 409,
      daten: { fehler: "letzter_inhaber" },
    });
    expect((await inhaber.json(pfad, { method: "DELETE" })).status).toBe(409);
    expect(server.db.select().from(mitglieder).all()).toEqual([
      expect.objectContaining({ nutzerId: inhaber.nutzerId, rolle: "inhaber" }),
    ]);
  });

  it("lose access at once when removed", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const technik = await server.eingeladen(inhaber, "technik");
    expect((await technik.anfrage("/api/v1/ich")).status).toBe(200);
    const weg = await inhaber.anfrage(`/api/v1/mitglieder/${technik.nutzerId}`, {
      method: "DELETE",
    });
    expect(weg.status).toBe(204);
    expect((await technik.json("/api/v1/ich")).daten).toEqual({ fehler: "kein_betreiber" });
    expect(
      server.db
        .select()
        .from(member)
        .all()
        .map((m) => m.userId),
    ).toEqual([inhaber.nutzerId]);
  });

  it("are unknown by an id outside the operator", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const pfad = "/api/v1/mitglieder/gibt-es-nicht";
    expect((await inhaber.json(pfad, { method: "PATCH", body: { rolle: "technik" } })).status).toBe(
      404,
    );
    expect((await inhaber.json(pfad, { method: "DELETE" })).status).toBe(404);
    expect((await inhaber.json(pfad, { method: "PATCH", body: { rolle: "owner" } })).status).toBe(
      400,
    );
  });
});
