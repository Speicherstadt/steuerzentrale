/**
 * Calls of the Zentrale's API under the interface's own origin (Vite passes /api on). Errors come
 * back as values (CLAUDE.md): status 0 means no answer at all. After Speicherstadt/soll,
 * apps/web/src/api.ts.
 */
export type Antwort<T> =
  | { ok: true; status: number; daten: T }
  | { ok: false; status: number; fehler: string };

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
  const inhalt = (daten as { fehler?: string; code?: string } | null) ?? {};
  return { ok: false, status: antwort.status, fehler: inhalt.fehler ?? inhalt.code ?? "unbekannt" };
};
