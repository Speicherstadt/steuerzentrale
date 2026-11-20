import { type Antwort, api } from "./api.ts";

/**
 * Passkeys with the browser's own WebAuthn JSON helpers (parse…FromJSON, toJSON), so no library
 * stands between Better Auth's options and the authenticator
 */
const nichtMoeglich = (fehler: string): Antwort<never> => ({ ok: false, status: 0, fehler });

const unterstuetzt = (): boolean =>
  typeof PublicKeyCredential !== "undefined" &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function";

const alsJson = (credential: Credential | null) => (credential as PublicKeyCredential).toJSON();

export const passkeyRegistrieren = async (name: string): Promise<Antwort<unknown>> => {
  if (!unterstuetzt()) return nichtMoeglich("passkey_nicht_unterstuetzt");
  const optionen = await api<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/generate-register-options",
  );
  if (!optionen.ok) return optionen;
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(optionen.daten),
    });
  } catch {
    return nichtMoeglich("passkey_abgebrochen");
  }
  return api("/api/auth/passkey/verify-registration", {
    body: { response: alsJson(credential), name },
  });
};

export const passkeyAnmelden = async (): Promise<Antwort<unknown>> => {
  if (!unterstuetzt()) return nichtMoeglich("passkey_nicht_unterstuetzt");
  const optionen = await api<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/passkey/generate-authenticate-options",
  );
  if (!optionen.ok) return optionen;
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(optionen.daten),
    });
  } catch {
    return nichtMoeglich("passkey_abgebrochen");
  }
  return api("/api/auth/passkey/verify-authentication", {
    body: { response: alsJson(credential) },
  });
};
