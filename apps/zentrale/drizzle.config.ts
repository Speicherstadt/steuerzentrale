import { defineConfig } from "drizzle-kit";

// Migrations are generated with `bun run db:generate` and never edited once merged: a changed,
// applied migration stops the start (src/db/migrieren.ts). Layout from Speicherstadt/soll.
export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema-installationen.ts",
    "./src/db/schema-backups.ts",
    "./src/db/schema-manifeste.ts",
    "./src/db/schema-updates.ts",
    "./src/db/schema-benachrichtigungen.ts",
    "./src/db/auth-schema.ts",
  ],
  out: "./drizzle",
});
