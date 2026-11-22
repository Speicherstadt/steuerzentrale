# Notes for Claude

Steuerzentrale: installs, updates, backs up and watches the Speicherstadt apps (Haben, Belegt,
Kontext, Schreibzeug, Stellwerk, Fixpunkt, Kennwort, Soll) on servers: shared ones, one per
customer, or one at the customer. One Zentrale (API and UI), one agent on every managed server that
connects out to it and runs only the actions an app's manifest describes. No app is built in: the
Zentrale knows only manifests. Open source (AGPL), contributions under the DCO.

## Where to look

| What | Where |
| --- | --- |
| What to build next, acceptance criteria, how the loop works | `BAULISTE.md` |
| Why: goals, architecture, the apps, manifest, decisions, stack, data model, security, tests | `docs/plan.md` |
| Look and behaviour of the UI | `DESIGN.md`, the mockup in `design/mockup/` (read the screen before building it) |
| The manifest of each app and the source of every value | `manifeste/<app>/` |
| Setup, commands, what CI and the PR rules check | `docs/mitwirken.md` |
| Runtime packages a workspace may use, with the reason | `allowed-dependencies.json` |

The documentation is in `docs/`, German only. Links in the README and the docs point to the site,
not to `docs/*.md`.

## The agent loop

Work through `BAULISTE.md` as it describes: the first open item whose dependencies are done, one
item per pull request, tests first, then **merge it yourself** (squash) once CI is green, and tick
the item in the same pull request. A security-relevant change (see „Pull requests“) needs an
independent review by a separate subagent (`tdd-review`) with no findings left before the merge.
An open loop pull request whose session has stopped is finished first (`BAULISTE.md`, step 0). Never wait for a person: open questions are decided by
`docs/plan.md` ("Entscheidungen"), and a new decision is written there with its reason. An item that
fails three times goes under "Zurückgestellt" with the reason and the loop goes on with the next
independent one. Steps only a person can do (servers, domain, contracts, changes in the app repos)
are not on the loop's path.

## Reference implementations and sources

Base details on the sources, not on memory. Clone repositories shallowly (`git clone --depth 1`)
into the scratchpad and name the source in comments, tests, `QUELLEN.md` and commit messages where
it settles a detail.

- **The apps**: `Speicherstadt/<app>` for every manifest value (Quadlets in `deploy/quadlet/`, compose
  files, Dockerfiles, env schema, health route, backup scripts). A value without a source file is not written;
  the source of an image digest is the registry query `scripts/digest.ts` records (registry, tag, date).
- **Kennwort and Soll**: `Speicherstadt/kennwort`, `Speicherstadt/soll` for the same stack in
  practice (Solid 2, Hono, Better Auth, Paraglide, `packages/ui`, CI, docs, loop files).
- **Podman Quadlets**: `podman-systemd.unit(5)` and the Podman docs for rootless operation; the
  Quadlets of Haben and Kontext as examples; **Caddy**: its admin API docs;
  **restic**: its docs for repositories, `backup`, `forget`, `check`, `restore`.
- **firsttris/workflows**: `tech-stack.md`, the reusable release workflows.

## Never

- Let the agent run anything an app's manifest does not describe, or a manifest without a valid
  signature: no shell, no free `podman exec`, no command as a string, no image without a digest.
- Put the real manifest signing key on the Zentrale, a server or in CI (CI signs only with the
  public test key in `test/schluessel/`, which release builds reject); give a server a DNS token or the backup
  key of an installation that does not run on it.
- Open a port on a managed server for the agent; the agent always connects out.
- Store a secret outside an encrypted column, return one through the API, or write one into a log
  (the one exception: the one-time setup code for the first owner, docs/plan.md, „Anmeldung“).
- Hard-code an app: no `if (app === "haben")`; what differs goes into the manifest schema.
- Update or reboot during an app's freeze window (`sperrzeiten`), or without a backup first.
- Delete a customer's data before the notice period ends or without a backup.
- Change another Speicherstadt repository from this loop; the apps are sources to read.
- Point tests at a real server or real customer data; skip, weaken or delete a test or a gate to get
  green; report a skipped test as passed.
- Add a runtime dependency without an entry and reason in `allowed-dependencies.json`, with a
  version that is not exact or outside the entry's `major`, or a package from its `forbidden` list.
  `bun add` installs npm's `latest`, which for TanStack Router and Query is still the Solid 1 line:
  name the version (`bun add @tanstack/solid-router@2.0.0-rc.11 --exact`).
- Push to `main`, merge a security-relevant change without the independent review, create or comment on issues and pull
  requests without being asked.
- Stop the user's processes or containers, or work around `sudo`.

## With every change

Update what the change affects, in the same pull request, and only that:

- the tests for what changed: Vitest next to the code, database tests next to the module, agent
  tests against Podman with systemd in CI, Playwright for what a user does (desktop and `@phone`); a bug fix
  starts with a failing test;
- the docs in `docs/` that describe it (German only); `docs/manifest.md` with every schema change;
- `README.md` (German) when a feature a user sees is added, changed or removed;
- the texts in `messages/de.json` and `messages/en.json`;
- the demo fixtures in `apps/web/src/demo/` when the API changes;
- the screenshots after a change to the look: **Actions → Update screenshots → Run workflow**, then
  look at the new pictures.

## Checks

Green before every push, then check CI:

```sh
bun run check             # typecheck, lint, test, build
bun run test:agent        # agent against Podman with systemd; CI has both
bun run e2e               # Playwright against Zentrale and agent in containers
zensical build --strict   # when docs/ or mkdocs.yml changed
```

Database tests run against SQLite in a temporary file; nothing needs a running database. What cannot
run locally (Podman, systemd, Incus VMs) is marked „nur CI“ under „Wie geprüft“ in the pull request;
CI decides.

## Pull requests

- One item per pull request; it carries only its own commits, each with `Signed-off-by` (DCO) of the
  maintainer (the loop session's Git identity) and Claude as `Co-Authored-By`.
- Title `Z-xxx: what is built` for a Bauliste item, else `Bereich: was sich ändert` (German, no
  trailing period); the description follows `.github/pull_request_template.md`.
  `.github/workflows/pr-regeln.yml` checks title, sign-off and the ticked item.
- Before every push check whether the branch's pull request is still open. If it is merged, start
  again from the current `origin/main` and open a **new** pull request.
- An independent review by a separate subagent before the merge (`tdd-review`) only for a
  security-relevant change: what the agent may run (manifests, signatures, jobs, argv), login, roles
  and rights, secrets and keys, separation of operators (`betreiber_id`), the audit log, the agent
  connection and certificates, the Pforte and network isolation, `install.sh`. Everything else is
  merged once CI is green.
- Merge method: squash.

## Working rules

- Commands as root (`sudo`, `pkexec`) on the user's machine are run by the user; don't work around
  that. Inside CI workflows `sudo` is allowed (Linux users, lingering, Incus).
- The user's running processes and containers are not stopped; use other ports for tests (dev:
  Zentrale 18300, Vite 5181; e2e: Zentrale 28300, Vite 5182) and own users and unit names
  (`sz-test-*`).
- Language: code, comments and commits in English; `README.md` and the docs in German; the app
  through Paraglide with `messages/de.json` and `messages/en.json`.

## Solid 2.0

The UI uses Solid 2.0 (stable since 11/2026). Its API differs a lot from 1.x, and most training data
is 1.x. Base every line of Solid code on the copy of the 2.0 docs in `docs/solid-2.0/`, not on memory.

- Before any work on Solid code read `docs/solid-2.0/MIGRATION.md` and the section „What changed from
  1.x“ at the end of `docs/solid-2.0/CHEATSHEET.md`; for a topic, its RFC (`03-control-flow.md`,
  `05-async-data.md`, `06-actions-optimistic.md`, `07-dom.md`, …). When unsure, look it up there; do
  not guess.
- Forbidden 1.x patterns (`bun run lint` fails on them, `scripts/solid-muster.ts`):
  - `createResource` → async `createMemo(() => fetchX(id()))` (or `createStore(fn)`) under `<Loading>`;
    `refetch` → `refresh(x)`, `mutate` → `action` + `createOptimistic`/`createOptimisticStore`
  - `createEffect` with one argument → `createEffect(compute, apply)`; cleanup is the apply's return
  - `on(...)` → the compute phase of a split effect; `defer` is an option of `createEffect`
  - `classList` → `class` with an object or array (`class={["card", { active: on() }]}`)
  - `Suspense`, `SuspenseList`, `ErrorBoundary` → `Loading`, `Reveal`, `Errored`
  - `Index`, `indexArray` → `<For keyed={false}>`, `mapArray`
  - `createComputed` → `createMemo`, split `createEffect` or `createSignal(fn)`
  - `batch` → nothing (writes batch by microtask); `flush()` only in tests or rare interop
  - `startTransition`, `useTransition` → built-in transitions, `isPending`, `action`
  - `onMount` → `onSettled`; `onError`/`catchError` → `<Errored>` or the effect `error` option
  - `mergeProps`/`splitProps` → `merge`/`omit` (`undefined` overrides in `merge`)
  - `produce` → draft setters are the default; path setters `setStore("a", "b", v)` → draft writes
  - `createMutable`/`modifyMutable` → `createStore` with draft setters; `unwrap` → `snapshot`
  - `createSelector` → `createProjection` or `createStore(fn)`; `observable` → `createEffect`
  - `createDynamic` and `<Dynamic>` → the `dynamic(source)` factory
  - `Context.Provider` → `<Context value={…}>`
  - imports from `solid-js/web`, `solid-js/store`, `solid-js/h`, `solid-js/html`,
    `solid-js/universal` → `@solidjs/web`, `solid-js`, `@solidjs/h`, `@solidjs/html`,
    `@solidjs/universal`; `jsxImportSource` is `@solidjs/web`
  - `use:` directives → `ref` directive factories; `attr:`, `bool:`, `on:`, `oncapture:` → plain
    attributes, `onClick`; lowercase `onclick={…}` is an attribute in 2.0 → `onClick`
  - `/*@once*/` → normal reactive JSX, `defaultValue`, or `untrack` in JavaScript
- Behaviour that compiles but works differently from 1.x (no lint can see it; check it in review):
  - a setter does not change what reads return until the microtask flush (`flush()` in tests);
  - writing a signal or store inside a memo, effect compute or component body throws in dev; write
    in event handlers, `action`s or `onSettled`;
  - no top-level reactive reads in a component body and no destructured props (`props.x` in JSX);
  - props are values: pass `count()`, not `count`;
  - `createMemo`'s second argument is options, not an initial value; `prev` starts `undefined`;
  - `isPending` is not 1.x `.loading`: it reports a change in flight, a bare `refresh()` is silent;
  - `createRoot` inside an owner is disposed with it (`runWithOwner(null, …)` to detach);
  - ref callbacks are unowned: no `onCleanup` inside them, use `onSettled` or a directive factory;
  - event handler bindings are not reactive: decide inside a stable handler;
  - `<For>` callback shape follows `keyed`; flow callbacks are owners, not tracking scopes;
  - boolean attributes are presence/absence, built-in attributes lowercase (`tabindex`).
- Router and data: `@tanstack/solid-router` 2.x and `@tanstack/solid-query` 6.x, the versions built
  for Solid 2 (state in `docs/solid-2.0/README.md`); never `lucide-solid` or a 1.x package.

## Code style

Technology choices follow `tech-stack.md` in firsttris/workflows and the stack of Kennwort and Soll,
with the same two deviations: **Solid 2 instead of React** and **a Hono server with a static SPA
instead of TanStack Start**. The SPA uses TanStack Router (file-based routes) and TanStack Query for
server data, in their Solid 2 versions (section „Solid 2.0“). The agent is TypeScript too, compiled with `bun build --compile`, so
Zentrale and agent share `packages/protokoll` and `packages/manifest` without type drift.

Clean Code, written functionally: clear names, small functions that do one thing, dependencies
passed in, no duplication or dead code, comments that say why; no classes, inheritance or class
hierarchies. Pure functions that take data and return data, side effects at the edges; errors as
values. A file does one thing: split it past ~400 lines, a function past ~80. A refactor changes no
behaviour.

## Project specifics

- Pure functions, no I/O: `packages/manifest` (schema, placement, rendering Quadlet units, Podman
  secrets and Caddy snippets) and `packages/planung` (update waves, freeze windows, maintenance windows, server
  checks). The Zentrale and the agent only call them.
- Jobs are stored in the Zentrale, carry an ID and are idempotent; the agent fetches, acknowledges,
  reports progress and result. A job names a manifest action and its arguments, never a command.
- Podman Quadlets under systemd, rootless: one Linux user per installation (`sz-<installation>`,
  lingering), its units in `~/.config/containers/systemd/`, own network and volumes, secrets as
  Podman secrets. Rootful only for an app whose manifest says `rootful: true`, which requires
  `server_fuer_sich`. Never set `AutoUpdate`: updates come only through the waves. One Caddy per
  server ("Pforte", user `sz-pforte`, `Network=host`), its admin API on localhost only; each
  installation has its own `.network` and publishes its HTTP service only with
  `PublishPort=127.0.0.1:<port>:…`, the port assigned by the Zentrale; the client IP arrives in the
  Pforte's `X-Forwarded-For`. Podman 4.9 is the minimum: use only keys 4.9 knows.
- The Zentrale has three hostnames: the UI only over WireGuard, `agent.<domain>` (mTLS per server)
  and `api.<domain>` (tokens for the Portal). DNS records are set by the Zentrale through the
  Cloudflare API, never by a server.
- A partner is another operator (`betreiber`) in the same Zentrale, with its own servers, S3 target,
  app values and brand; there is no partner role.
- Every table with an operator's data carries `betreiber_id` (exempt: manifests, Better Auth's
  tables); every query filters by it; a test per endpoint proves that no
  operator or partner sees another's data. Writes go through one function that appends to the
  audit log in the same transaction.
- Secrets: encrypted columns with the key from `STEUERZENTRALE_SECRET_KEY` (32 bytes, base64); the
  Zentrale refuses to start without it. Agent certificates are stored as fingerprints, API tokens
  as hashes; the key can be rotated (key ID on every ciphertext).
- Times: instants as UTC milliseconds; freeze and maintenance windows in `Europe/Berlin`, DST
  changes tested.
