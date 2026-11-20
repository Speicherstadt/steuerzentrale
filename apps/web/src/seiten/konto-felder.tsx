import { Input, m } from "@steuerzentrale/ui";

/** Name, address and optional password of a new account (invitation, first owner) */
export const KontoFelder = () => (
  <>
    <Input label={m.einl_name()} name="name" autocomplete="name" required maxlength={100} />
    <Input label={m.anm_email()} name="email" type="email" autocomplete="email" required />
    <Input
      label={m.anm_passwort()}
      name="passwort"
      type="password"
      autocomplete="new-password"
      minlength={12}
      maxlength={128}
      hint={m.einl_passwort_hinweis()}
    />
  </>
);
