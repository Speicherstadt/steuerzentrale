import { Button, Input, m } from "@steuerzentrale/ui";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { api } from "../anmeldung/api.ts";
import { passkeyAnmelden } from "../anmeldung/webauthn.ts";
import { Fehler, fehlerText, felder, KartenSeite } from "../seiten/anmeldung-teile.tsx";

/**
 * Signing in (docs/anmeldung.md): a passkey, or the password and then the TOTP code. Better Auth
 * answers the password with `twoFactorRedirect` while the code is still missing.
 */
const Anmelden = () => {
  const navigate = useNavigate();
  const [fehler, setFehler] = createSignal("");
  const [codeFehlt, setCodeFehlt] = createSignal(false);
  const weiter = () => navigate({ to: "/" });

  const mitPasskey = async () => {
    const antwort = await passkeyAnmelden();
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    await weiter();
  };

  const mitPasswort = async (event: SubmitEvent) => {
    const { email = "", passwort = "" } = felder(event);
    const antwort = await api<{ twoFactorRedirect?: boolean }>("/api/auth/sign-in/email", {
      body: { email, password: passwort },
    });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    setFehler("");
    if (antwort.daten.twoFactorRedirect) return setCodeFehlt(true);
    await weiter();
  };

  const mitCode = async (event: SubmitEvent) => {
    const { code = "" } = felder(event);
    const antwort = await api("/api/auth/two-factor/verify-totp", { body: { code } });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    await weiter();
  };

  return (
    <KartenSeite titel={m.anm_titel()} text={codeFehlt() ? m.anm_code_text() : m.anm_text()}>
      <Show
        when={!codeFehlt()}
        fallback={
          <form class="grid gap-4" onSubmit={mitCode}>
            <Input
              label={m.anm_code()}
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
            <Fehler text={fehler()} />
            <Button type="submit" variant="primary">
              {m.anm_code_knopf()}
            </Button>
          </form>
        }
      >
        <Button variant="primary" onClick={mitPasskey}>
          {m.anm_passkey()}
        </Button>
        <p class="text-center text-xs text-muted-foreground">{m.anm_oder()}</p>
        <form class="grid gap-4" onSubmit={mitPasswort}>
          <Input label={m.anm_email()} name="email" type="email" autocomplete="username" required />
          <Input
            label={m.anm_passwort()}
            name="passwort"
            type="password"
            autocomplete="current-password"
            required
          />
          <Fehler text={fehler()} />
          <Button type="submit">{m.anm_knopf()}</Button>
        </form>
      </Show>
    </KartenSeite>
  );
};

export const Route = createFileRoute("/anmelden")({ component: Anmelden });
