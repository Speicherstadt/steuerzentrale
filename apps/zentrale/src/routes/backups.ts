import { BUCKET } from "@steuerzentrale/manifest";
import type { Context } from "hono";
import { z } from "zod";
import {
  backupJetzt,
  backupsDerInstallation,
  backupUebersicht,
  backupZielLesen,
  backupZielSetzen,
} from "../modules/backups/index.ts";
import { installationLesen } from "../modules/installationen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Backups (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)", "Backup
 * auf dem Server (Z-601)"): every role reads the runs of the installations and the S3 target, whose
 * admin access comes back only as `zugangGesetzt`; owner and technik set the target and start
 * "Backup jetzt", each with a reason. No answer carries an access, a password or a repository. An
 * installation of another operator is unknown.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An https origin, or http only on this machine (a MinIO beside the Zentrale, the tests' stand-in) */
const endpunkt = z
  .string()
  .max(300)
  .transform((wert, ctx) => {
    const url = URL.parse(wert.trim());
    const ursprung = url && url.pathname === "/" && !url.search && !url.username;
    const sicher =
      url?.protocol === "https:" || (url?.protocol === "http:" && LOOPBACK.has(url.hostname));
    if (ursprung && sicher) return url.origin;
    ctx.addIssue({ code: "custom", message: "an https origin without a path" });
    return z.NEVER;
  });

const geheim = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, "printable ASCII without spaces");

const zielSchema = z
  .object({
    endpunkt,
    region: z.string().regex(/^[a-z0-9-]{1,40}$/),
    bucket: z.string().regex(BUCKET),
    accessKey: geheim.optional(),
    secretKey: geheim.min(8).optional(),
    grund: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((z) => (z.accessKey === undefined) === (z.secretKey === undefined), {
    message: "access key and secret key go together",
  });

const grundSchema = z.object({ grund: z.string().trim().min(1).max(500) }).strict();

const STATUS: Record<string, 404 | 409 | 422> = {
  keine_installation: 404,
  laeuft_nicht: 409,
  nicht_eingerichtet: 409,
  backup_laeuft: 409,
  ziel_in_benutzung: 409,
  zugang_fehlt: 422,
  nicht_ausfuehrbar: 422,
};

const fehler = (c: Context<Anfrage>, f: { grund: string; detail?: string | undefined }) =>
  c.json(
    { fehler: f.grund, ...(f.detail === undefined ? {} : { detail: f.detail }) },
    STATUS[f.grund] ?? 400,
  );

export const backupRouten = (route: Registrar, deps: RoutenDeps): void => {
  const kontext = (c: Context<Anfrage>, grund: string) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund,
  });
  const installationId = (c: Context<Anfrage>) => c.req.param("installationId") ?? "";

  route("GET /api/v1/backups", (c) =>
    c.json({ installationen: backupUebersicht(deps.db, c.get("betreiberId")) }),
  );

  route("GET /api/v1/backup-ziel", (c) => c.json(backupZielLesen(deps.db, c.get("betreiberId"))));

  route("PUT /api/v1/backup-ziel", async (c) => {
    const angaben = await eingabe(c, zielSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, accessKey, secretKey, ...ort } = angaben;
    const zugang = accessKey && secretKey ? { accessKey, secretKey } : undefined;
    const gesetzt = backupZielSetzen(deps, kontext(c, grund), { ...ort, zugang });
    if (!gesetzt.ok) return fehler(c, gesetzt);
    // accesses that waited for a target (or a new admin access) are tried at once
    deps.backupAnstossen?.();
    return c.json(gesetzt.ziel);
  });

  route("GET /api/v1/installationen/:installationId/backups", (c) => {
    const i = installationLesen(deps.db, c.get("betreiberId"), installationId(c));
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json(backupsDerInstallation(deps.db, i));
  });

  route("POST /api/v1/installationen/:installationId/backup", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const r = backupJetzt(deps, kontext(c, angaben.grund), installationId(c));
    if (!r.ok) return fehler(c, r);
    const { auftragId, aktion, zustand, angelegtAm } = r.auftrag;
    return c.json({ auftrag: { auftragId, aktion, zustand, angelegtAm } }, 201);
  });
};
