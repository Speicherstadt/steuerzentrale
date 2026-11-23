import { auftraege } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { KENNWORT, LIZENZ, type Testmanifest } from "./installationen.ts";
import { type Json, manifestHochladen } from "./installationen-api.ts";
import type { TestServer } from "./server.ts";

/*
 * For the HTTP tests of the actions (Z-405) and support accesses (Z-802): a running installation of
 * one of the test manifests, made through the API by the operator's person, and its jobs marked
 * done as the agent would have reported them.
 */

type Person = Awaited<ReturnType<TestServer["inhaber"]>>;

const alsTest = (betreiberId: string) => ({ betreiberId, akteur: "test", jetzt: 1, grund: "Test" });

/** All jobs of the installation done, as the agent would have reported */
export const allesErledigt = (server: TestServer, betreiberId: string, installationId: string) =>
  schreiben(server.schreibDb, alsTest(betreiberId), "test", (w) => {
    for (const a of server.db.select().from(auftraege).all())
      if (a.installationId === installationId)
        w.aendern("auftraege", { auftragId: a.auftragId }, { zustand: "erfolgreich" });
  });

/** A running installation of the customer on the server, made by `p`; its id */
export const laufendeInstallation = async (
  server: TestServer,
  json: Json,
  p: Person,
  ort: { kundeId: string; serverId: string },
  app: Testmanifest,
  host: string,
): Promise<string> => {
  const a = await json(p, "/api/v1/installationen", {
    body: {
      ...ort,
      ...(await manifestHochladen(json, p, app)),
      optionen: [],
      host,
      einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
      betreiberWerte: { PROBE_LIZENZ: LIZENZ },
      grund: "Auftrag",
    },
  });
  if (a.status !== 201) throw new Error(`anlegen ${a.status} ${JSON.stringify(a.daten)}`);
  const id = String(a.daten.installationId);
  schreiben(server.schreibDb, alsTest(p.betreiberId), "test", (w) =>
    w.aendern("installationen", { installationId: id }, { zustand: "laeuft" }),
  );
  allesErledigt(server, p.betreiberId, id);
  return id;
};
