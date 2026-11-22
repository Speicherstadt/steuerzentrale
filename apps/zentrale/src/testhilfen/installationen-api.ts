import { schreiben } from "../modules/audit/index.ts";
import { FAKTEN } from "./installationen.ts";
import type { TestServer } from "./server.ts";

/*
 * For the HTTP tests of installations and settings (Z-402, Z-404): a customer with its contract and
 * a server whose agent is connected in memory and reported its facts, each made through the API of
 * the operator of the person `p`.
 */

type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };
export type Json = (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
) => Promise<Antwort>;

export const BEGINN = Date.UTC(2026, 10, 30, 23);

/** A customer of the operator with a running contract; its id */
export const kundeAnlegen = async (json: Json, p: Pick<Person, "json">, name = "Kanzlei Nord") => {
  const { daten } = await json(p, "/api/v1/kunden", {
    body: {
      name,
      kontakt: { name: "Kim", email: "kim@kanzlei.test" },
      vertrag: { sla: "basis", beginn: BEGINN },
      grund: "Vertrag",
    },
  });
  return String(daten.id);
};

/** A server of the operator with facts and a connected agent, keeping what it gets; its id */
export const serverMitAgent = async (
  server: TestServer,
  json: Json,
  p: Person,
  gesendet: Record<string, unknown>[],
) => {
  const { daten } = await json(p, "/api/v1/server", {
    body: {
      name: "Server A",
      art: "gemeinsam",
      wartungsfenster: { tage: [0], von: "03:00", bis: "04:00" },
      grund: "neu",
    },
  });
  const id = String(daten.serverId);
  const kontext = {
    betreiberId: p.betreiberId,
    akteur: "test",
    jetzt: server.jetzt(),
    grund: "Test",
  };
  schreiben(server.schreibDb, kontext, "test", (w) =>
    w.aendern(
      "server",
      { serverId: id },
      { fakten: JSON.stringify(FAKTEN), faktenAm: server.jetzt() },
    ),
  );
  const sockel = { senden: (t: string) => gesendet.push(JSON.parse(t)), schliessen: () => {} };
  server.deps.verbindungen.anmelden(p.betreiberId, id, sockel, server.jetzt());
  server.deps.verbindungen.gruessen(p.betreiberId, id, sockel);
  return id;
};
