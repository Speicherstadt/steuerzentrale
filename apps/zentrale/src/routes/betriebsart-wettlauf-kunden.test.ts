import { afterAll, beforeAll, expect, it } from "vitest";
import { auditLog, betreiber, kunden } from "../db/schema.ts";
import { kundeAnlegen } from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };
let server: TestServer;
let inhaber: Person;
const json = async (p: Pick<Person, "json">, pfad: string, init?: Parameters<Person["json"]>[1]) =>
  (await p.json(pfad, init)) as Antwort;

beforeAll(async () => {
  server = testServer(afterAll);
  inhaber = await server.inhaber();
}, 60_000);

it("creates no customer once the switch to `selbst` succeeded (concurrent requests)", async () => {
  await json(inhaber, "/api/v1/betriebsart", { method: "PUT", body: { betriebsart: "kunden" } });
  const [, wechsel] = await Promise.all([
    kundeAnlegen(json, inhaber, "Wettlauf GmbH"),
    json(inhaber, "/api/v1/betriebsart", {
      method: "PUT",
      body: { betriebsart: "selbst", grund: "Nur für mich" },
    }),
  ]);
  const b = server.db.select().from(betreiber).all()[0];
  const wettlauf = server.db
    .select()
    .from(kunden)
    .all()
    .filter((k) => k.name === "Wettlauf GmbH");
  expect(wechsel.status).toBe(200);
  expect(b?.betriebsart).toBe("selbst");
  // A customer made before the switch is allowed (only other customers' installations block it,
  // BAULISTE.md Z-805); one written after the switch is not: its audit entry must come first
  const nummer = (aktion: string) =>
    server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === aktion)
      .map((e) => e.nummer);
  const wechselNummer = Math.max(...nummer("betriebsart.selbst"));
  if (wettlauf.length > 0) expect(Math.max(...nummer("kunde.anlegen"))).toBeLessThan(wechselNummer);
});
