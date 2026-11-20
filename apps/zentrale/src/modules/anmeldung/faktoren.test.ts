import { describe, expect, it } from "vitest";
import { zweiterFaktorVorhanden } from "./faktoren.ts";

describe("zweiterFaktorVorhanden", () => {
  it("is enough with a passkey and no password", () => {
    expect(zweiterFaktorVorhanden({ passwort: false, totp: false, passkeys: 1 })).toBe(true);
  });

  it("needs TOTP with a password", () => {
    expect(zweiterFaktorVorhanden({ passwort: true, totp: true, passkeys: 0 })).toBe(true);
    expect(zweiterFaktorVorhanden({ passwort: true, totp: false, passkeys: 0 })).toBe(false);
  });

  it("needs TOTP with a password even beside a passkey, which would leave the password alone", () => {
    expect(zweiterFaktorVorhanden({ passwort: true, totp: false, passkeys: 2 })).toBe(false);
  });

  it("is missing for an account with nothing", () => {
    expect(zweiterFaktorVorhanden({ passwort: false, totp: false, passkeys: 0 })).toBe(false);
    expect(zweiterFaktorVorhanden({ passwort: false, totp: true, passkeys: 0 })).toBe(false);
  });
});
