import type { AccessSchluessel } from "./schluessel.ts";

/*
 * A token of Cloudflare Access (BAULISTE.md Z-1104; Cloudflare docs, "Validate JWTs" and
 * "Application token"): the header `Cf-Access-Jwt-Assertion`, a JWT signed with RS256 by the team's
 * key named in `kid`. The signature is checked first, then that `iss` is the team's domain, `aud`
 * holds our application's AUD tag, `exp` is in the future and `nbf` not. Nothing in the token
 * chooses where the keys come from.
 */

export type AccessPruefung =
  | { ok: true; email: string | null }
  | {
      ok: false;
      grund:
        | "kein_token"
        | "form"
        | "alg"
        | "schluessel"
        | "signatur"
        | "iss"
        | "aud"
        | "abgelaufen"
        | "noch_nicht";
    };

export type AccessOptionen = {
  team: string;
  aud: string;
  /** Now, in ms */
  jetzt: number;
  schluessel: AccessSchluessel;
};

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const TEIL = /^[A-Za-z0-9_-]+$/;
/** A token is a few hundred bytes; a longer one is not read */
const MAX_LAENGE = 16 * 1024;

const json = (teil: string): Record<string, unknown> | undefined => {
  try {
    const wert: unknown = JSON.parse(Buffer.from(teil, "base64url").toString("utf8"));
    return typeof wert === "object" && wert !== null && !Array.isArray(wert)
      ? (wert as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const nein = (grund: Extract<AccessPruefung, { ok: false }>["grund"]): AccessPruefung => ({
  ok: false,
  grund,
});

const claimsPruefen = (p: Record<string, unknown>, o: AccessOptionen): AccessPruefung => {
  if (p.iss !== `https://${o.team}.cloudflareaccess.com`) return nein("iss");
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(o.aud)) return nein("aud");
  const s = o.jetzt / 1000;
  if (typeof p.exp !== "number" || p.exp <= s) return nein("abgelaufen");
  if (p.nbf !== undefined && (typeof p.nbf !== "number" || p.nbf > s)) return nein("noch_nicht");
  return { ok: true, email: typeof p.email === "string" ? p.email : null };
};

export const accessPruefen = async (
  token: string | null | undefined,
  o: AccessOptionen,
): Promise<AccessPruefung> => {
  if (!token) return nein("kein_token");
  const teile = token.split(".");
  if (token.length > MAX_LAENGE || teile.length !== 3 || !teile.every((t) => TEIL.test(t)))
    return nein("form");
  const [h = "", n = "", s = ""] = teile;
  const kopf = json(h);
  const nutzlast = json(n);
  if (!kopf || !nutzlast) return nein("form");
  if (kopf.alg !== "RS256" || typeof kopf.kid !== "string") return nein("alg");
  const schluessel = await o.schluessel.finden(kopf.kid);
  if (!schluessel) return nein("schluessel");
  const echt = await crypto.subtle.verify(
    ALG,
    schluessel,
    Buffer.from(s, "base64url"),
    new TextEncoder().encode(`${h}.${n}`),
  );
  return echt ? claimsPruefen(nutzlast, o) : nein("signatur");
};
