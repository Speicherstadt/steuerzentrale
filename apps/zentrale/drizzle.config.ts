import { defineConfig } from "drizzle-kit";

// Migrations are generated with `bun run db:generate` and never edited once merged: a changed,
// applied migration stops the start (src/db/migrieren.ts). Layout from Speicherstadt/soll.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
