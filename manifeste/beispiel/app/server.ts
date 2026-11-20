/**
 * The example app of the Steuerzentrale's tests (Z-202): a small HTTP service with a SQLite volume,
 * a health route, a worker for its option, a migration as named command, an export for the backup
 * and a TCP echo on the port the Zentrale assigns. No real app is built into the Zentrale; this one
 * exists only to drive installs, updates, backups and restores in CI.
 *
 * Modes (argv[2]): server (default), worker, migrieren, export.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const VERSION = process.env.BEISPIEL_VERSION ?? "0.0.0";
// The broken build of the tests: health red, so an update to it must be rolled back (Z-503)
const KAPUTT = process.env.BEISPIEL_KAPUTT === "1";
const DATEN = process.env.BEISPIEL_DATEN ?? "/daten";
const HTTP_PORT = Number(process.env.BEISPIEL_HTTP_PORT ?? "8080");
const TCP_PORT = Number(process.env.BEISPIEL_TCP_PORT ?? "9000");

const oeffnen = () => {
  mkdirSync(DATEN, { recursive: true });
  const db = new Database(`${DATEN}/beispiel.db`, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  return db;
};

const migrieren = (db: Database) => {
  db.run(
    "CREATE TABLE IF NOT EXISTS eintraege (id INTEGER PRIMARY KEY, text TEXT NOT NULL, version TEXT NOT NULL)",
  );
  db.run("CREATE TABLE IF NOT EXISTS schlaege (zeit INTEGER NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS migrationen (version TEXT PRIMARY KEY)");
  db.query("INSERT OR IGNORE INTO migrationen (version) VALUES (?)").run(VERSION);
};

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { "content-type": "application/json" } });

const server = (db: Database) => {
  migrieren(db);
  Bun.serve({
    port: HTTP_PORT,
    hostname: "0.0.0.0",
    fetch: async (anfrage) => {
      const url = new URL(anfrage.url);
      if (url.pathname === "/health")
        return KAPUTT ? json({ ok: false }, 500) : json({ ok: true, version: VERSION });
      if (url.pathname === "/anfrage")
        // What the app sees of the request: the Pforte's X-Forwarded-For carries the client (Z-401)
        return json({
          xForwardedFor: anfrage.headers.get("x-forwarded-for"),
          host: anfrage.headers.get("host"),
        });
      if (url.pathname === "/eintraege" && anfrage.method === "POST") {
        const { text } = (await anfrage.json()) as { text: string };
        db.query("INSERT INTO eintraege (text, version) VALUES (?, ?)").run(String(text), VERSION);
        return json({ ok: true }, 201);
      }
      if (url.pathname === "/") {
        const eintraege = db.query("SELECT id, text, version FROM eintraege ORDER BY id").all();
        const migrationen = db.query("SELECT version FROM migrationen ORDER BY version").all();
        return json({ version: VERSION, eintraege, migrationen });
      }
      return json({ fehler: "nicht gefunden" }, 404);
    },
  });
  Bun.listen({
    hostname: "0.0.0.0",
    port: TCP_PORT,
    socket: { data: (socket, daten) => void socket.write(daten) },
  });
  console.log(
    JSON.stringify({ msg: "beispiel listening", version: VERSION, http: HTTP_PORT, tcp: TCP_PORT }),
  );
};

const modus = process.argv[2] ?? "server";
const db = oeffnen();
if (modus === "server") server(db);
else if (modus === "migrieren") {
  migrieren(db);
  console.log(JSON.stringify({ msg: "migrated", version: VERSION }));
} else if (modus === "export") {
  migrieren(db);
  process.stdout.write(
    `${JSON.stringify(db.query("SELECT id, text, version FROM eintraege ORDER BY id").all())}\n`,
  );
} else if (modus === "worker") {
  migrieren(db);
  setInterval(() => db.query("INSERT INTO schlaege (zeit) VALUES (?)").run(Date.now()), 10_000);
} else {
  console.error(`unknown mode ${modus}`);
  process.exit(2);
}
