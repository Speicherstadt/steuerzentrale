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

The documentation is in `docs/`, German only. Links in the README and the docs point to the site,
not to `docs/*.md`.

## The agent loop

Work through `BAULISTE.md` as it describes: the first open item whose dependencies are done, one
item per pull request, tests first, an independent review by a separate subagent (`tdd-review`),
then **merge it yourself** (squash) once CI is green and the review has no findings left, and tick
the item in the same pull request. Never wait for a person: open questions are decided by
`docs/plan.md` ("Entscheidungen"), and a new decision is written there with its reason. An item that
fails three times goes under "Zurückgestellt" with the reason and the loop goes on with the next
independent one. Steps only a person can do (servers, domain, contracts, changes in the app repos)
are not on the loop's path.

## Reference implementations and sources

Base details on the sources, not on memory. Clone repositories shallowly (`git clone --depth 1`)
into the scratchpad and name the source in comments, tests, `QUELLEN.md` and commit messages where
it settles a detail.

- **The apps**: `Speicherstadt/<app>` for every manifest value (compose files, Dockerfiles, env
  schema, health route, backup scripts). A value without a source file is not written.
- **Kennwort and Soll**: `Speicherstadt/kennwort`, `Speicherstadt/soll` for the same stack in
  practice (Solid 2, Hono, Better Auth, Paraglide, `packages/ui`, CI, docs, loop files).
- **Docker Compose**: the Compose Specification (compose-spec.io); **Caddy**: its admin API docs;
  **restic**: its docs for repositories, `backup`, `forget`, `check`, `restore`.
- **firsttris/workflows**: `tech-stack.md`, the reusable release workflows.

## Never

- Let the agent run anything an app's manifest does not describe: no shell, no free `docker exec`,
  no command from the Zentrale as a string.
- Open a port on a managed server for the agent; the agent always connects out.
- Store a secret outside an encrypted column, return one through the API, or write one into a log.
- Hard-code an app: no `if (app === "haben")`; what differs goes into the manifest schema.
- Update or reboot during an app's freeze window (`sperrzeiten`), or without a backup first.
- Delete a customer's data before the notice period ends or without a backup.
- Change another Speicherstadt repository from this loop; the apps are sources to read.
- Point tests at a real server or real customer data; skip, weaken or delete a test or a gate to get
  green; report a skipped test as passed.
- Push to `main`, merge without the independent review, create or comment on issues and pull
  requests without being asked.
- Stop the user's processes or containers, or work around `sudo`.

## With every change

Update what the change affects, in the same pull request, and only that:

- the tests for what changed: Vitest next to the code, database tests next to the module, agent
  tests against Docker in CI, Playwright for what a user does (desktop and `@phone`); a bug fix
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
bun run typecheck && bun run lint && bun run test && bun run build
bun run test:agent        # agent against Docker; needs a Docker daemon (CI has one)
bun run e2e               # Playwright against Zentrale and agent in containers
zensical build --strict   # when docs/ or mkdocs.yml changed
```

Database tests run against SQLite in a temporary file; nothing needs a running database.

## Pull requests

- One item per pull request; it carries only its own commits, each with `Signed-off-by` (DCO).
- Before every push check whether the branch's pull request is still open. If it is merged, start
  again from the current `origin/main` and open a **new** pull request.
- An independent review by a separate subagent before the merge (`tdd-review`).
- Merge method: squash.

## Working rules

- Commands as root (`sudo`, `pkexec`) are run by the user; don't work around that.
- The user's running processes and containers are not stopped; use other ports for tests (dev:
  Zentrale 18300, Vite 5181; e2e: Zentrale 28300, Vite 5182) and own Compose project names
  (`sz-test-*`).
- Language: code, comments and commits in English; `README.md` and the docs in German; the app
  through Paraglide with `messages/de.json` and `messages/en.json`.

## Code style

Technology choices follow `tech-stack.md` in firsttris/workflows and the stack of Kennwort and Soll,
with the same two deviations: **Solid 2 instead of React** and **a Hono server with a static SPA
instead of TanStack Start**. The agent is TypeScript too, compiled with `bun build --compile`, so
Zentrale and agent share `packages/protokoll` and `packages/manifest` without type drift.

Clean Code, written functionally: clear names, small functions that do one thing, dependencies
passed in, no duplication or dead code, comments that say why; no classes, inheritance or class
hierarchies. Pure functions that take data and return data, side effects at the edges; errors as
values. A file does one thing: split it past ~400 lines, a function past ~80. A refactor changes no
behaviour.

## Project specifics

- Pure functions, no I/O: `packages/manifest` (schema, placement, rendering Compose, `.env` and
  Caddy snippets) and `packages/planung` (update waves, freeze windows, maintenance windows, server
  checks). The Zentrale and the agent only call them.
- Jobs are stored in the Zentrale, carry an ID and are idempotent; the agent fetches, acknowledges,
  reports progress and result. A job names a manifest action and its arguments, never a command.
- One Compose project per installation in `/srv/steuerzentrale/<installation>`, own network and
  volumes, `.env` with mode 0600. One Caddy per server ("Pforte"), its admin API on localhost only.
- Every table carries `betreiber_id`; every query filters by it; a test per endpoint proves that no
  operator or partner sees another's data. Writes go through one function that appends to the
  audit log in the same transaction.
- Secrets: encrypted columns with the key from `STEUERZENTRALE_SECRET_KEY` (32 bytes, base64); the
  Zentrale refuses to start without it. Agent keys and API tokens are stored as hashes.
- Times: instants as UTC milliseconds; freeze and maintenance windows in `Europe/Berlin`, DST
  changes tested.
