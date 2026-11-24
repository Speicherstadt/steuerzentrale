import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { betreiber, installationen } from "../db/schema.ts";
import { KENNWORT, LIZENZ } from "../testhilfen/installationen.ts";
import {
  kundeAnlegen,
  manifestHochladen,
  serverMitAgent,
} from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };
let server: TestServer;
let inhaber: Person;
let serverId: string;
const json = async (p: Pick<Person, "json">, pfad: string, init?: Parameters<Person["json"]>[1]) =>
  (await p.json(pfad, init)) as Antwort;

beforeAll(async () => {
  server = testServer(afterAll);
  inhaber = await server.inhaber();
  serverId = await serverMitAgent(server, json, inhaber, []);
  await manifestHochladen(json, inhaber);
}, 60_000);

it("never leaves `selbst` with another customer's installation (concurrent install and switch)", async () => {
  await json(inhaber, "/api/v1/betriebsart", { method: "PUT", body: { betriebsart: "kunden" } });
  const fremd = await kundeAnlegen(json, inhaber);
  const [inst, wechsel] = await Promise.all([
    json(inhaber, "/api/v1/installationen", {
      body: {
        kundeId: fremd,
        serverId,
        app: "probe",
        version: "1.0.0",
        optionen: [],
        host: "wett.kanzlei.test",
        einstellungen: { PROBE_TITEL: "W", PROBE_KENNWORT: KENNWORT },
        betreiberWerte: { PROBE_LIZENZ: LIZENZ },
        grund: "Auftrag",
      },
    }),
    json(inhaber, "/api/v1/betriebsart", {
      method: "PUT",
      body: { betriebsart: "selbst", grund: "Nur für mich" },
    }),
  ]);
  const b = server.db
    .select()
    .from(betreiber)
    .all()
    .find((x) => x.betriebsart !== null);
  const fremde = server.db
    .select()
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, b?.betreiberId ?? ""),
        ne(installationen.zustand, "entfernt"),
        ne(installationen.kundeId, b?.eigenerKundeId ?? ""),
      ),
    )
    .all()
    .map((i) => i.kundeId);
  console.log(inst.status, wechsel.status, b?.betriebsart);
  expect(b?.betriebsart === "selbst" ? fremde : []).toEqual([]);
});
