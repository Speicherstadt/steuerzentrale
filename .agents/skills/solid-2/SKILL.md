---
name: solid-2
description: "Code für die Oberfläche der Steuerzentrale in Solid 2.0 schreiben oder prüfen, dessen API sich stark von 1.x unterscheidet: verbotene Muster aus 1.x, was anders wirkt, Router und Daten. Vor jeder Arbeit an Solid-Code laden, auch im Review."
---

# Solid 2.0

Die Oberfläche nutzt Solid 2.0 (stabil seit 11/2026). Seine API unterscheidet sich stark von 1.x, und die meisten
Trainingsdaten sind 1.x. Jede Zeile Solid-Code stützt sich auf die Kopie der Doku von 2.0 in `docs/solid-2.0/`,
nicht auf das Gedächtnis.

## Vor der Arbeit

`docs/solid-2.0/MIGRATION.md` lesen und den Abschnitt „What changed from 1.x“ am Ende von
`docs/solid-2.0/CHEATSHEET.md`; für ein Thema seinen RFC (`03-control-flow.md`, `05-async-data.md`,
`06-actions-optimistic.md`, `07-dom.md`, …). Im Zweifel dort nachsehen, nicht raten.

## Verbotene Muster aus 1.x

`bun run lint` schlägt bei ihnen fehl (`scripts/solid-muster.ts`):

- `createResource` → async `createMemo(() => fetchX(id()))` (oder `createStore(fn)`) unter `<Loading>`;
  `refetch` → `refresh(x)`, `mutate` → `action` + `createOptimistic`/`createOptimisticStore`
- `createEffect` mit einem Argument → `createEffect(compute, apply)`; das Aufräumen ist der Rückgabewert von apply
- `on(...)` → die compute-Phase eines geteilten Effekts; `defer` ist eine Option von `createEffect`
- `classList` → `class` mit Objekt oder Array (`class={["card", { active: on() }]}`)
- `Suspense`, `SuspenseList`, `ErrorBoundary` → `Loading`, `Reveal`, `Errored`
- `Index`, `indexArray` → `<For keyed={false}>`, `mapArray`
- `createComputed` → `createMemo`, geteiltes `createEffect` oder `createSignal(fn)`
- `batch` → nichts (Schreiben wird je Microtask gebündelt); `flush()` nur in Tests oder seltener Interop
- `startTransition`, `useTransition` → eingebaute Transitions, `isPending`, `action`
- `onMount` → `onSettled`; `onError`/`catchError` → `<Errored>` oder die Effekt-Option `error`
- `mergeProps`/`splitProps` → `merge`/`omit` (`undefined` überschreibt in `merge`)
- `produce` → Draft-Setter sind der Standard; Pfad-Setter `setStore("a", "b", v)` → Schreiben in den Draft
- `createMutable`/`modifyMutable` → `createStore` mit Draft-Settern; `unwrap` → `snapshot`
- `createSelector` → `createProjection` oder `createStore(fn)`; `observable` → `createEffect`
- `createDynamic` und `<Dynamic>` → die Fabrik `dynamic(source)`
- `Context.Provider` → `<Context value={…}>`
- Importe aus `solid-js/web`, `solid-js/store`, `solid-js/h`, `solid-js/html`, `solid-js/universal` →
  `@solidjs/web`, `solid-js`, `@solidjs/h`, `@solidjs/html`, `@solidjs/universal`; `jsxImportSource` ist
  `@solidjs/web`
- `use:`-Direktiven → `ref`-Direktiv-Fabriken; `attr:`, `bool:`, `on:`, `oncapture:` → einfache Attribute,
  `onClick`; kleingeschriebenes `onclick={…}` ist in 2.0 ein Attribut → `onClick`
- `/*@once*/` → normales reaktives JSX, `defaultValue` oder `untrack` in JavaScript

## Kompiliert, wirkt aber anders als 1.x

Kein Lint sieht das; im Review prüfen:

- ein Setter ändert, was Lesen zurückgibt, erst nach dem Flush des Microtasks (`flush()` in Tests);
- ein Signal oder Store in einem Memo, der compute-Phase eines Effekts oder im Rumpf einer Komponente zu schreiben,
  wirft im Dev-Modus; geschrieben wird in Event-Handlern, `action`s oder `onSettled`;
- kein reaktives Lesen oben im Rumpf einer Komponente und keine destrukturierten Props (`props.x` im JSX);
- Props sind Werte: `count()` übergeben, nicht `count`;
- das zweite Argument von `createMemo` sind Optionen, kein Startwert; `prev` beginnt mit `undefined`;
- `isPending` ist nicht `.loading` aus 1.x: es meldet eine laufende Änderung, ein bloßes `refresh()` bleibt still;
- `createRoot` in einem Owner wird mit ihm entsorgt (`runWithOwner(null, …)` zum Lösen);
- Ref-Callbacks haben keinen Owner: kein `onCleanup` darin, `onSettled` oder eine Direktiv-Fabrik nehmen;
- Bindungen von Event-Handlern sind nicht reaktiv: innerhalb eines stabilen Handlers entscheiden;
- die Form des Callbacks von `<For>` folgt `keyed`; Callbacks der Ablaufsteuerung sind Owner, keine Tracking-Scopes;
- boolesche Attribute heißen da oder nicht da, eingebaute Attribute klein (`tabindex`).

## Router und Daten

`@tanstack/solid-router` 2.x und `@tanstack/solid-query` 6.x, die Versionen für Solid 2 (Stand in
`docs/solid-2.0/README.md`); nie `lucide-solid` oder ein Paket für 1.x. Eine Version immer ausdrücklich nennen
(`docs/entwicklung.md`, Abhängigkeiten).
