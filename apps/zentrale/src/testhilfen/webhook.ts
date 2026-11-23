import {
  SIGNATUR_HEADER,
  signaturPruefen,
  ZUSTELLUNG_HEADER,
} from "../modules/benachrichtigung/signatur.ts";

/*
 * A receiver of webhooks for the tests (BAULISTE.md Z-703), as the Portal will be one (Z-903): a Bun
 * server on a free port of localhost that checks every request's signature with the key it shares
 * with the Zentrale (`signaturPruefen`) and answers 401 to one that does not hold; `scheitern(n)`
 * answers the next n requests with 503 as a receiver that is down. Every request is kept.
 */

export type Empfang = {
  zustellungId: string | null;
  body: string;
  host: string | null;
  signatur: ReturnType<typeof signaturPruefen>;
  status: number;
};

export const webhookEmpfaenger = (
  schluessel: string,
  o: { jetzt?: () => number; tls?: { cert: string; key: string } } = {},
) => {
  const empfangen: Empfang[] = [];
  let scheitert = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    ...(o.tls ? { tls: o.tls } : {}),
    fetch: async (anfrage) => {
      const body = await anfrage.text();
      const signatur = signaturPruefen(
        schluessel,
        anfrage.headers.get(SIGNATUR_HEADER),
        body,
        (o.jetzt ?? Date.now)(),
      );
      const status = scheitert > 0 ? 503 : signatur.ok ? 204 : 401;
      if (scheitert > 0) scheitert -= 1;
      empfangen.push({
        zustellungId: anfrage.headers.get(ZUSTELLUNG_HEADER),
        body,
        host: anfrage.headers.get("host"),
        signatur,
        status,
      });
      return new Response(null, { status });
    },
  });
  return {
    url: (pfad = "/hooks/zentrale") =>
      `${o.tls ? "https" : "http"}://127.0.0.1:${server.port}${pfad}`,
    port: server.port,
    empfangen,
    scheitern: (n: number) => {
      scheitert = n;
    },
    stoppen: () => server.stop(true),
  };
};
