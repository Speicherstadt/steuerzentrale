import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * An imported manifest (BAULISTE.md Z-501; docs/plan.md, "Manifeste in der Zentrale (Z-501)"): the
 * signed text of one version of an app with its minisign signature, for every operator, so without
 * `betreiber_id` (docs/plan.md, "Mandanten"). A version is imported once and never changes:
 * triggers in the migration refuse every UPDATE and DELETE. `sha256` is the hash of the text,
 * `dringend` the manifest's mark. `importiert_von` is who imported it (a person's id, `befehl` for
 * `steuerzentrale manifest importieren`, `uebernommen` for the manifest of an installation made
 * before Z-501), `importiert_von_betreiber` the operator of that person, null otherwise.
 */
export const manifeste = sqliteTable(
  "manifeste",
  {
    app: text("app").notNull(),
    version: text("version").notNull(),
    text: text("text").notNull(),
    signatur: text("signatur").notNull(),
    sha256: text("sha256").notNull(),
    dringend: integer("dringend", { mode: "boolean" }).notNull(),
    importiertAm: integer("importiert_am").notNull(),
    importiertVon: text("importiert_von").notNull(),
    importiertVonBetreiber: text("importiert_von_betreiber"),
  },
  (t) => [primaryKey({ columns: [t.app, t.version] })],
);
