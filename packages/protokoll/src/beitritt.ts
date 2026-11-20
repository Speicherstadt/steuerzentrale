import { z } from "zod";
import { pem } from "./pem.ts";

/*
 * Joining a server (BAULISTE.md Z-302): before the agent has a certificate it speaks plain HTTPS to
 * `agent.<domain>` once, exchanging the one-time token from the install command for its client
 * certificate (docs/plan.md, "TLS und Zertifikate"). The agent makes its key itself and sends only a
 * certificate request (PKCS#10, PEM); the key never leaves the server.
 */

/** The path of the exchange under `agent.<domain>` */
export const BEITRITT_PFAD = "/api/v1/agent/beitreten";

export const BeitrittAnfrage = z
  .object({
    protokoll: z.number().int().positive(),
    /** The one-time token: 32 random bytes in base64url */
    token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
    csr: pem("CERTIFICATE REQUEST"),
    agentVersion: z.string().min(1).max(100),
    architektur: z.enum(["amd64", "arm64"]),
  })
  .strict();

export const BeitrittAntwort = z.object({
  serverId: z.string().min(1).max(200),
  /** The agent's client certificate and the CA of its operator that issued it, PEM */
  zertifikat: pem("CERTIFICATE"),
  ca: pem("CERTIFICATE"),
  gueltigBis: z.number().int().nonnegative(),
});

export type BeitrittAnfrage = z.infer<typeof BeitrittAnfrage>;
export type BeitrittAntwort = z.infer<typeof BeitrittAntwort>;
