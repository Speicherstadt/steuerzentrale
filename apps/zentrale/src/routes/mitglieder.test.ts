import { describe, expect, it } from "vitest";
import { member } from "../db/auth-schema.ts";
import { auditLog, mitglieder } from "../db/schema.ts";
import { PASSWORT, testServer } from "../testhilfen/server.ts";

describe("the members of an operator", () => {
  it("are listed with name, address and role", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const inhaber2 = await server.eingeladen(inhaber, "inhaber");
    const { status, daten } = await inhaber2.json("/api/v1/mitglieder");
    expect(status).toBe(200);
    expect(daten).toEqual({
      mitglieder: [
        expect.objectContaining({
          nutzerId: inhaber.nutzerId,
          name: "Ines Inhaber",
          rolle: "inhaber",
        }),
        expect.objectContaining({
          nutzerId: inhaber2.nutzerId,
          email: inhaber2.email,
          rolle: "inhaber",
        }),
      ],
    });
  });

  it("change role through the owner, in Better Auth, the mirror and the audit log, at once", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const mitglied = await server.eingeladen(inhaber, "mitglied");
    expect((await mitglied.anfrage("/api/v1/einladungen")).status).toBe(403);
    const geaendert = await inhaber.json(`/api/v1/mitglieder/${mitglied.nutzerId}`, {
      method: "PATCH",
      body: { rolle: "inhaber" },
    });
    expect(geaendert).toEqual({
      status: 200,
      daten: { nutzerId: mitglied.nutzerId, rolle: "inhaber" },
    });
    expect((await mitglied.anfrage("/api/v1/einladungen")).status).toBe(200);
    expect(server.db.select().from(member).all()).toContainEqual(
      expect.objectContaining({ userId: mitglied.nutzerId, role: "inhaber" }),
    );
    expect(server.db.select().from(auditLog).all().at(-1)).toMatchObject({
      aktion: "mitglied.rolle",
      akteur: inhaber.nutzerId,
      ziel: `mitglieder:${mitglied.nutzerId}`,
    });
  });

  it("keep their last owner: neither demoted nor removed", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const pfad = `/api/v1/mitglieder/${inhaber.nutzerId}`;
    expect(await inhaber.json(pfad, { method: "PATCH", body: { rolle: "mitglied" } })).toEqual({
      status: 409,
      daten: { fehler: "letzter_inhaber" },
    });
    expect((await inhaber.json(pfad, { method: "DELETE" })).status).toBe(409);
    expect(server.db.select().from(mitglieder).all()).toEqual([
      expect.objectContaining({ nutzerId: inhaber.nutzerId, rolle: "inhaber" }),
    ]);
  });

  // Z-1207: members and invitations never asked for a reason; each write stands in the audit log
  it("are changed, removed and invited without a reason, each in the audit log", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const zweite = await server.eingeladen(inhaber, "mitglied", "zweite@betreiber.test");
    const anzahl = () => server.db.select().from(auditLog).all().length;
    const pfad = `/api/v1/mitglieder/${zweite.nutzerId}`;
    const schritte: [string, string, Record<string, unknown> | undefined, number][] = [
      ["PATCH", pfad, { rolle: "inhaber" }, 200],
      ["DELETE", pfad, undefined, 204],
      ["POST", "/api/v1/einladungen", { rolle: "mitglied" }, 201],
    ];
    for (const [method, ziel, body, status] of schritte) {
      const vorher = anzahl();
      const r = await inhaber.anfrage(ziel, { method, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${ziel}`).toBe(status);
      expect(anzahl(), `${method} ${ziel}`).toBeGreaterThan(vorher);
    }
    const { daten } = await inhaber.json("/api/v1/einladungen");
    const einladungId = (daten as { einladungen: { einladungId: string }[] }).einladungen[0]
      ?.einladungId;
    const vorher = anzahl();
    const weg = await inhaber.anfrage(`/api/v1/einladungen/${einladungId}`, { method: "DELETE" });
    expect(weg.status).toBe(204);
    expect(anzahl()).toBeGreaterThan(vorher);
  });

  it("lose access at once when removed", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const inhaber2 = await server.eingeladen(inhaber, "inhaber");
    expect((await inhaber2.anfrage("/api/v1/ich")).status).toBe(200);
    const weg = await inhaber.anfrage(`/api/v1/mitglieder/${inhaber2.nutzerId}`, {
      method: "DELETE",
    });
    expect(weg.status).toBe(204);
    expect((await inhaber2.json("/api/v1/ich")).daten).toEqual({ fehler: "kein_betreiber" });
    expect(
      server.db
        .select()
        .from(member)
        .all()
        .map((m) => m.userId),
    ).toEqual([inhaber.nutzerId]);
  });

  it.each([
    ["removed", { method: "DELETE" }],
    ["demoted", { method: "PATCH", body: { rolle: "mitglied" } }],
  ] as const)("keep no way back in through their own open invitations when %s", async (_, init) => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const zweite = await server.eingeladen(inhaber, "inhaber", "zweite@betreiber.test");
    const { daten } = await zweite.json("/api/v1/einladungen", { body: { rolle: "inhaber" } });
    const token = String((daten as { link: string }).link).split("#")[1] ?? "";
    const vonInhaber = await inhaber.json("/api/v1/einladungen", { body: { rolle: "mitglied" } });
    expect(vonInhaber.status).toBe(201);
    const geaendert = await inhaber.anfrage(`/api/v1/mitglieder/${zweite.nutzerId}`, init);
    expect(geaendert.ok).toBe(true);
    const zurueck = await server.browser().json("/api/v1/einladung/annehmen", {
      body: { token, name: "Wieder da", email: "wieder@betreiber.test", passwort: PASSWORT },
    });
    expect(zurueck.status).toBe(404);
    // the invitations of those who still may invite stay
    expect((await inhaber.json("/api/v1/einladungen")).daten).toMatchObject({
      einladungen: [{ rolle: "mitglied" }],
    });
  });

  it("are unknown by an id outside the operator", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const pfad = "/api/v1/mitglieder/gibt-es-nicht";
    expect((await inhaber.json(pfad, { method: "PATCH", body: { rolle: "inhaber" } })).status).toBe(
      404,
    );
    expect((await inhaber.json(pfad, { method: "DELETE" })).status).toBe(404);
    expect((await inhaber.json(pfad, { method: "PATCH", body: { rolle: "owner" } })).status).toBe(
      400,
    );
  });
});
