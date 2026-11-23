import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installationen } from "./schema-installationen.ts";

/*
 * What follows the end of a customer's contract for each of its installations (BAULISTE.md Z-604;
 * docs/plan.md, "Kündigung und Löschung"), re-exported by schema.ts; carries betreiber_id like every
 * table with an operator's data.
 */

/**
 * The steps of an installation after its contract ended, one after the other: `archiv` (read only
 * if the app offers it, the last backup and the archive for the customer), `warten` (until 90 days
 * after the end), `loeschen` (the last backup and taking the installation down on its server),
 * `repository` (the objects below its prefix), `zugang` (its S3 access at MinIO), `dns` (its
 * records at Cloudflare), `geloescht`
 */
export const ABWICKLUNG_SCHRITTE = [
  "archiv",
  "warten",
  "loeschen",
  "repository",
  "zugang",
  "dns",
  "geloescht",
] as const;

/**
 * One installation of a customer whose contract ended, made by the loop in modules/abwicklung once
 * the end is reached and removed again if the notice is taken back before the deletion began.
 * `archiv_auftrag_id` and `loesch_auftrag_id` name the last job of each chain; `archiv` is JSON
 * `{ am, objekte: [{ tag, datei, bytes }] }` of the archive the agent uploaded (a link is made on
 * request and never stored; `link_bis` keeps until when the last one is valid); `protokoll` is the
 * deletion log, JSON `[{ schritt, zeitpunkt, detail }]`, which goes out as the event
 * `installation_geloescht`. `versuche` and `naechster_versuch` are the backoff of a step that
 * failed, as for DNS.
 */
export const abwicklungen = sqliteTable(
  "abwicklungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    kundeId: text("kunde_id").notNull(),
    vertragsende: integer("vertragsende").notNull(),
    schritt: text("schritt", { enum: ABWICKLUNG_SCHRITTE }).notNull(),
    archivAuftragId: text("archiv_auftrag_id"),
    archiv: text("archiv"),
    loeschAuftragId: text("loesch_auftrag_id"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: integer("naechster_versuch"),
    protokoll: text("protokoll").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
    linkBis: integer("link_bis"),
    geloeschtAm: integer("geloescht_am"),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId] }),
    index("abwicklungen_kunde").on(t.betreiberId, t.kundeId),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);
