> **Kopie im Repo der Steuerzentrale.** Quelle: https://github.com/solidjs/solid, Commit
> `83d42baeb8f4d50e509e10a001b9f0a739d10a30` (2026-11-20). Kopiert wurden alle Dateien aus
> `documentation/solid-2.0/` (darin `MIGRATION.md`) und `packages/solid/CHEATSHEET.md`; einzige Änderung
> hier ist der Link auf `CHEATSHEET.md` unten. Nicht von Hand ändern: für einen neueren Stand neu kopieren
> und Commit und Datum hier anpassen.
>
> **Solid-Pakete in diesem Repo und ihr Stand zu Solid 2** (geprüft am 2026-11-20 über die `peerDependencies`
> auf npm):
>
> | Paket | Version | Solid 2 |
> | --- | --- | --- |
> | `solid-js`, `@solidjs/web` | 2.0.3 | ja |
> | `@solidjs/vite-plugin` | 3.0.1 | ja (`solid-js ^2.0.0`) |
> | `@tanstack/solid-query` | 6.0.0-rc.6 | ja (`solid-js ^2.0.0`), noch Release Candidate; 5.x verlangt Solid 1 |
> | `@tanstack/solid-router` | 2.0.0-rc.11 | selbst ja (`solid-js >=2.0.1`), noch Release Candidate; 1.x verlangt Solid 1. Zieht `@solid-primitives/refs ^1.0.8` (Solid 1, für Solid 2 gibt es 3.0.0), `@solid-devtools/logger ^0.9.4` (Solid 1) und `@solidjs/meta 0.29.4` (`solid-js >=1.8.4`, für 1.x gebaut) mit |
> | `@tanstack/router-plugin` | 1.169.0 | ja, Build-Werkzeug ohne Solid-Laufzeit (`vite-plugin-solid` nur optional) |
> | `lucide` | 1.76.0 | ja, Icon-Daten ohne Solid; `lucide-solid` verlangt Solid 1 und ist nicht erlaubt |

# Solid 2.0 RFCs

The Solid 2.0 RFCs, frozen as the design record at the 2.0.0 release (2026-11-17). They explain why 2.0 is shaped the way it is; they are not kept current. **`MIGRATION.md`** is maintained and is the entry point for migrating apps; current behavior is documented at https://docs.solidjs.com.

**Overview:** [Solid 2.0 Proposed API Changes (HackMD)](https://hackmd.io/@0u1u3zEAQAO0iYWVAStEvw/SyXYy2swbg)

**Start here (migration guide):** [MIGRATION.md](MIGRATION.md)

**Quick API reference:** [`CHEATSHEET.md`](CHEATSHEET.md) (lives inside `packages/solid/` so it ships with the `solid-js` npm package).

The RFCs below are **deep dives** on specific topic areas. Over time, it’s expected that the most important bits will be folded into the main docs; these are intentionally detailed and “proposal-shaped”.

---

## RFC index (12)

| #   | RFC                                                                                    | One-line summary                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 01  | [Reactivity, batching, and effects](01-reactivity-batching-effects.md)                 | ownedWrite, strict top-level reads, flush, split effects, lazy memos, unobserved, onSettled      |
| 02  | [Signals, derived primitives, ownership, and context](02-signals-derived-ownership.md) | Derived signal/store, createRoot dispose-by-parent, Context as Provider                          |
| 03  | [Control flow](03-control-flow.md)                                                     | For/Repeat/Reveal, Show/Switch, Loading, Errored, dynamic, clientOnly                            |
| 04  | [Stores](04-stores.md)                                                                 | draft-first setters, merge/omit, reconcile, projections (createProjection/createStore(fn)), deep |
| 05  | [Async data](05-async-data.md)                                                         | Async in computations, isPending, latest, Loading `on` prop, transitions, ssrSource/deferStream  |
| 06  | [Actions and optimistic](06-actions-optimistic.md)                                     | action (generator), createOptimistic / createOptimisticStore                                     |
| 07  | [DOM](07-dom.md)                                                                       | HTML standards, class, booleans                                                                  |
| 08  | [Dev-mode diagnostics](08-dev-diagnostics.md)                                          | Dev warnings/errors, diagnostic codes, attribution engine, responsiveness, programmatic API       |
| 09  | [TypeScript and JSX ownership](09-typescript-jsx.md)                                   | Renderer-owned JSX namespaces, `jsxImportSource`, and core renderable types                      |
| 10  | [Server functions](10-server-functions.md)                                             | `"use server"` runtime, response helpers, single-flight, GET/metadata/prepareRequest, validation |
| 11  | [Server components (experimental)](11-server-components.md)                           | Functions returned from server functions; `dynamic` is the API; single-copy frame streams        |
| 12  | [SSR and the HTTP exchange](12-ssr-http.md)                                            | Render entry points, streaming (`pipe`/`pipeTo`/`readable`), request event, httpStatus/httpHeader |
