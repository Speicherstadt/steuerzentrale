// Messages between the Zentrale and the agent, shared by both so they cannot drift apart
// (docs/plan.md, "Technologie"). Z-301 adds the message schemas.

/** The protocol version; the Zentrale also understands the version before it (Z-301, Z-504) */
export const PROTOKOLL_VERSION = 1;

/** The version of the Steuerzentrale, the same for Zentrale and agent; kept equal to package.json (test) */
export const VERSION = "0.0.0";
