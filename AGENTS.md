# Notes for coding agents

[`CLAUDE.md`](CLAUDE.md) holds the rules for this repository: where to look, what must never happen, what every
change carries and how to check it. They apply to every agent, not only Claude.

The UI uses **Solid 2.0**, whose API differs a lot from 1.x: read `docs/solid-2.0/MIGRATION.md` before touching
Solid code and follow the section „Solid 2.0“ in `CLAUDE.md`; `bun run lint` fails on 1.x patterns.
