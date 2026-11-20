import { z } from "zod";

/** A PEM text of the given kind, at most 16 KiB: a certificate or a request, never more */
export const pem = (art: string) =>
  z
    .string()
    .max(16_384)
    .refine((text) => text.trimStart().startsWith(`-----BEGIN ${art}-----`), {
      message: `not a PEM ${art}`,
    });
