import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { testDatenbank } from "./db/test-db.ts";
import { auslieferung } from "./modules/server/index.ts";
import { verbindungen } from "./modules/verbindung/verbindungen.ts";
import { versionen } from "./modules/versionen/index.ts";

const setup = () => {
  const lines: string[] = [];
  const { db, schreibDb, anmeldeGeheimnis, schluessel } = testDatenbank();
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
