/**
 * One JSON line per request, without secrets (AGENTS.md, "Nie"): no part of the query (a token
 * can stand there as key or value), no headers at all (Authorization, cookies, client certificates)
 * and no bodies. Modelled on Speicherstadt/soll, apps/server/src/log.ts.
 */

export type RequestLog = {
  time: string;
  method: string;
  path: string;
  status: number;
  ms: number;
};

export type LogSink = (line: string) => void;

/** The path of a URL, with a query only marked as `?…` */
export const redactUrl = (url: string): string => {
  const parsed = new URL(url, "http://zentrale.invalid");
  return parsed.search.length > 1 ? `${parsed.pathname}?…` : parsed.pathname;
};

export const formatRequestLog = (entry: RequestLog): string => JSON.stringify(entry);
