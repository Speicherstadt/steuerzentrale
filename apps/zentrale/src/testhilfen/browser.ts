import { randomInt } from "node:crypto";
import type { Hono } from "hono";
import type { Anfrage } from "../routes/zugang.ts";

/** The interface's origin in tests (e2e port, never a real server) */
export const TEST_URL = "http://localhost:28300";

/** Plumbing of the tests only: the socket address a test request comes from */
export const SOCKET_HEADER = "x-test-socket";

/** An address from the benchmarking range (RFC 2544) per browser, so the rate limit keeps them apart */
const zufallsAdresse = () => `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

export type Init = { method?: string; body?: unknown; headers?: Record<string, string> };

/** The cookies of one browser, by name, as Set-Cookie leaves them */
const keksdose = () => {
  const kekse = new Map<string, string>();
  return {
    kopf: () => [...kekse].map(([name, wert]) => `${name}=${wert}`).join("; "),
    merken: (antwort: Response) => {
      for (const zeile of antwort.headers.getSetCookie()) {
        const [paar = "", ...attribute] = zeile.split(";");
        const [name = "", wert = ""] = paar.split(/=(.*)/s);
        const abgelaufen = attribute.some((a) => /^\s*max-age=0\s*$/i.test(a)) || wert === "";
        if (abgelaufen) kekse.delete(name.trim());
        else kekse.set(name.trim(), wert);
      }
    },
  };
};

/** A browser of one person against the app: keeps its cookies, sends Origin and its address */
export const browserFuer =
  (app: Hono<Anfrage>) =>
  (adresse = zufallsAdresse()) => {
    const dose = keksdose();
    const anfrage = async (pfad: string, init: Init = {}) => {
      const antwort = await app.request(`${TEST_URL}${pfad}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          "content-type": "application/json",
          origin: TEST_URL,
          [SOCKET_HEADER]: adresse,
          ...(dose.kopf() ? { cookie: dose.kopf() } : {}),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      dose.merken(antwort);
      return antwort;
    };
    const json = async (pfad: string, init: Init = {}) => {
      const antwort = await anfrage(pfad, init);
      return { status: antwort.status, daten: (await antwort.json().catch(() => null)) as never };
    };
    /** Takes over the cookies a server-side call set, as the browser would from its response */
    const uebernehmen = (headers: Headers) => dose.merken(new Response(null, { headers }));
    return { anfrage, json, adresse, uebernehmen };
  };

export type Browser = ReturnType<ReturnType<typeof browserFuer>>;

/** A request that must succeed; its JSON body */
export const erfolgreich = async (b: Browser, pfad: string, init: Init = {}) => {
  const antwort = await b.anfrage(pfad, init);
  if (!antwort.ok) throw new Error(`${pfad}: ${antwort.status} ${await antwort.text()}`);
  return (await antwort.json()) as Record<string, unknown>;
};
