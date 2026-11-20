import { BeitrittAnfrage } from "@steuerzentrale/protokoll";
import type { Context } from "hono";
import { clientAdresse } from "../modules/anmeldung/adresse.ts";
import { beitreten, type Drossel, drossel, istDatei } from "../modules/server/index.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

// A join is a request of a few kilobytes; anything far larger is not one
const MAX_BEITRITT_BYTES = 64 * 1024;
// Per address: a server joins once; ten tries in ten minutes leave room for a typo and a retry
export const BEITRITT_GRENZE = 10;
export const BEITRITT_FENSTER_MS = 10 * 60_000;

const keinCache = { "cache-control": "no-store" };

const koerper = async (c: Context<Anfrage>): Promise<unknown> => {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BEITRITT_BYTES) return undefined;
  const text = await c.req.text().catch(() => "");
  if (text.length > MAX_BEITRITT_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * What `agent.<domain>` serves before an agent has its certificate (BAULISTE.md Z-302): the install
 * script, the binaries with their signed checksums, and the exchange of the one-time token for the
 * client certificate, behind a rate limit per client address
 */
export const agentRouten = (
  route: Registrar,
  deps: RoutenDeps,
  begrenzt: Drossel = drossel(BEITRITT_GRENZE, BEITRITT_FENSTER_MS),
): void => {
  route("GET /install.sh", async (c) => {
    const skript = await deps.auslieferung.skript();
    if (!skript) return c.json({ fehler: "agent_dateien_fehlen" }, 404);
    return c.body(skript, 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      ...keinCache,
    });
  });

  route("GET /agent/:datei", async (c) => {
    const name = c.req.param("datei") ?? "";
    const datei = istDatei(name) ? deps.auslieferung.datei(name) : undefined;
    if (!datei || !(await datei.exists())) return c.json({ fehler: "nicht_gefunden" }, 404);
    const art = name.startsWith("SHA256SUMS")
      ? "text/plain; charset=utf-8"
      : "application/octet-stream";
    return c.body(datei.stream(), 200, { "content-type": art, ...keinCache });
  });

  route("POST /api/v1/agent/beitreten", async (c) => {
    const adresse =
      clientAdresse(deps.socketAdresse(c.req.raw, c.env), c.req.header("x-forwarded-for")) ?? "";
    if (!begrenzt(adresse, deps.now())) return c.json({ fehler: "zu_viele_versuche" }, 429);
    const anfrage = BeitrittAnfrage.safeParse(await koerper(c));
    if (!anfrage.success) return c.json({ fehler: "ungueltig" }, 400);
    const ergebnis = await beitreten(deps, anfrage.data, deps.now());
    if (!ergebnis.ok)
      return c.json({ fehler: ergebnis.grund }, ergebnis.grund === "token_ungueltig" ? 401 : 400);
    return c.json(ergebnis.antwort, 201);
  });
};
