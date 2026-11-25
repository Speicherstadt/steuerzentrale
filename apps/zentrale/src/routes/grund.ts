import { z } from "zod";

/**
 * The reason of a write (BAULISTE.md Z-1207; docs/plan.md, "Grund (Z-1207)"): taken, never
 * required. Without one the write still stands in the audit log, with an empty reason.
 */
export const grund = z.string().trim().max(500).default("");
