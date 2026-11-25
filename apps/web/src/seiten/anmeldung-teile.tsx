import type { JSX } from "@solidjs/web";
import { m } from "@steuerzentrale/ui";
import { Show } from "solid-js";

/**
 * The frame of the pages outside the shell (sign-in, setup, invitation): one card in the middle,
 * with the page's heading (DESIGN.md, "Bausteine")
 */
export const KartenSeite = (props: { titel: string; text?: string; children: JSX.Element }) => (
  <main class="grid min-h-svh place-items-center bg-sidebar px-4 py-8">
    <section class="grid w-full max-w-md gap-5 rounded-xl border bg-background p-6">
      <div class="grid gap-1">
        <p class="text-xs font-medium text-muted-foreground">{m.app_name()}</p>
        <h1 class="text-2xl font-semibold tracking-tight">{props.titel}</h1>
        <Show when={props.text}>
          <p class="text-muted-foreground">{props.text}</p>
        </Show>
      </div>
      {props.children}
    </section>
  </main>
);

/** An error the page reports, read out at once */
export const Fehler = (props: { text: string }) => (
  <p role="alert" class={["text-danger", { hidden: !props.text }]}>
    {props.text}
  </p>
);

const TEXTE: Record<string, () => string> = {
  netz: m.fehler_netz,
  ungueltig: m.fehler_ungueltig,
  passkey_nicht_unterstuetzt: m.fehler_passkey_nicht_unterstuetzt,
  passkey_abgebrochen: m.fehler_passkey_abgebrochen,
  email_vergeben: m.fehler_email_vergeben,
  einladung_ungueltig: m.fehler_einladung_ungueltig,
  code_ungueltig: m.fehler_code_ungueltig,
  abgeschlossen: m.fehler_abgeschlossen,
  keine_berechtigung: m.fehler_keine_berechtigung,
  INVALID_CODE: m.fehler_code,
  INVALID_EMAIL_OR_PASSWORD: m.fehler_falsch,
};

/** The text for an error of the API; a refused request of the rate limit has its own */
export const fehlerText = (antwort: { status: number; fehler: string }): string =>
  antwort.status === 429 ? m.fehler_zu_viele() : (TEXTE[antwort.fehler] ?? m.fehler_unbekannt)();

export const ROLLEN_TEXT: Record<string, () => string> = {
  inhaber: m.rolle_inhaber,
  mitglied: m.rolle_mitglied,
};

/** A form's fields as text, trimmed; an empty optional field is left out */
export const felder = (event: SubmitEvent): Record<string, string> => {
  event.preventDefault();
  const daten = new FormData(event.currentTarget as HTMLFormElement);
  return Object.fromEntries(
    [...daten.entries()]
      .map(([name, wert]) => [name, String(wert).trim()] as const)
      .filter(([, wert]) => wert !== ""),
  );
};
