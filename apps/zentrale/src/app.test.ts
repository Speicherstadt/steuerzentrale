import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import type { Db } from "./db/oeffnen.ts";
import { testDatenbank } from "./db/test-db.ts";
import { auslieferung } from "./modules/server/index.ts";
import { verbindungen } from "./modules/verbindung/verbindungen.ts";
import { versionen } from "./modules/versionen/index.ts";

const setup = (teil: { db?: Db; web?: string } = {}) => {
  const lines: string[] = [];
  const offen = testDatenbank();
  const { schreibDb, anmeldeGeheimnis, schluessel } = offen;
  const db = teil.db ?? offen.db;
  const url = "http://localhost:28300";
  const app = createApp({
    log: (line) => lines.push(line),
    now: () => 0,
    version: "1.2.3",
    db,
    schreibDb,
    auth: createAuth({ schreibDb, url, geheimnis: anmeldeGeheimnis }),
    url,
    schluessel,
    agentUrl: url,
    auslieferung: auslieferung(undefined, url),
    socketAdresse: () => undefined,
    verbindungen: verbindungen(4409),
    versionen: versionen({ db, schreibDb, fetch, now: () => 0, log: () => {} }),
    ...(teil.web === undefined ? {} : { web: teil.web }),
  });
  return { app, lines };
};

describe("GET /health", () => {
  it("answers ok with the version", async () => {
    const { app } = setup();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "1.2.3" });
  });

  // Z-704: an external monitor sees a Zentrale that runs but cannot read its database
  it("answers 503 without a reason when the database does not answer", async () => {
    const kaputt = {
      select: () => {
        throw new Error("database is locked");
      },
    } as unknown as Db;
    const { app } = setup({ db: kaputt });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "fehler", version: "1.2.3" });
  });
});

// Z-1004: the image serves the interface from STEUERZENTRALE_WEB; the API's paths stay 404
describe("the interface's files", () => {
  const webOrdner = () => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-web-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    writeFileSync(join(ordner, "index.html"), "<!doctype html><title>Steuerzentrale</title>");
    return ordner;
  };

  it("answers a route of the SPA with index.html", async () => {
    const { app } = setup({ web: webOrdner() });
    const res = await app.request("/erster-inhaber");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain("<title>Steuerzentrale</title>");
  });

  it("leaves unknown API paths and other methods at 404, and serves nothing without a folder", async () => {
    const { app } = setup({ web: webOrdner() });
    expect((await app.request("/api/v1/unbekannt")).status).toBe(404);
    expect((await app.request("/erster-inhaber", { method: "POST" })).status).toBe(404);
    expect((await setup().app.request("/erster-inhaber")).status).toBe(404);
  });
});

describe("request log", () => {
  it("writes one line per request with method, path and status", async () => {
    const { app, lines } = setup();
    await app.request("/health");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      method: "GET",
      path: "/health",
      status: 200,
    });
  });

  it("holds no query value, no Authorization and no cookie header", async () => {
    const { app, lines } = setup();
    await app.request("/health?token=query-geheim-1", {
      headers: {
        Authorization: "Bearer auth-geheim-2",
        Cookie: "session=cookie-geheim-3",
        "X-Client-Cert-Fingerprint": "cert-geheim-4",
      },
    });
    const all = lines.join("\n");
    for (const secret of [
      "query-geheim-1",
      "token",
      "auth-geheim-2",
      "cookie-geheim-3",
      "cert-geheim-4",
    ])
      expect(all).not.toContain(secret);
  });

  it("logs unknown routes too, with their status", async () => {
    const { app, lines } = setup();
    await app.request("/nirgends?a=b");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ path: "/nirgends?…", status: 404 });
  });
});
