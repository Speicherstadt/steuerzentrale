/**
 * Calls of the Zentrale's API under the interface's own origin (Vite passes /api on). Errors come
 * back as values (docs/entwicklung.md): status 0 means no answer at all. After Speicherstadt/soll,
 * apps/web/src/api.ts.
 */

/** A reason of the Zentrale as a code with its values, e.g. why an app does not fit a server */
export type Grund = { code: string; werte: Record<string, string | number> };

export type Fehlschlag = {
  ok: false;
  status: number;
  fehler: string;
  /** What the Zentrale adds to some codes: the finding of a manifest or a value that does not render */
  detail?: string;
  /** Every reason of a refusal such as `passt_nicht` */
  gruende?: Grund[];
};

export type Antwort<T> = { ok: true; status: number; daten: T } | Fehlschlag;

type Fehlerkoerper = { fehler?: string; code?: string; detail?: unknown; gruende?: unknown };

const fehlschlag = (status: number, inhalt: Fehlerkoerper): Fehlschlag => ({
  ok: false,
  status,
  fehler: inhalt.fehler ?? inhalt.code ?? "unbekannt",
  ...(typeof inhalt.detail === "string" ? { detail: inhalt.detail } : {}),
  ...(Array.isArray(inhalt.gruende) ? { gruende: inhalt.gruende as Grund[] } : {}),
});

export const api = async <T>(
  pfad: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Antwort<T>> => {
  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, status: 0, fehler: "netz" };
  }
  const text = await antwort.text().catch(() => "");
  let daten: unknown = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, status: antwort.ok ? 0 : antwort.status, fehler: "netz" };
  }
  if (antwort.ok) return { ok: true, status: antwort.status, daten: daten as T };
  return fehlschlag(antwort.status, (daten as Fehlerkoerper | null) ?? {});
};
