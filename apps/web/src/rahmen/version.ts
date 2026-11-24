import { version } from "../../../../package.json" with { type: "json" };

/** The version of this build, from the root package.json that the release bumps (docs/release.md) */
export const VERSION: string = version;
