import { Button, buttonClass, Input, m } from "@steuerzentrale/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import { api } from "../anmeldung/api.ts";
import { Fehler, fehlerText, felder, KartenSeite } from "../seiten/anmeldung-teile.tsx";
import { KontoFelder } from "../seiten/konto-felder.tsx";

/**
 * The first owner (docs/anmeldung.md): with the setup code from the Zentrale's log, operator and
 * owner are created; then on to the second factor. Once set up the page only points to the sign-in.
 */
const ErsterInhaber = () => {
  const navigate = useNavigate();
  const [offen, setOffen] = createSignal<boolean>();
  const [fehler, setFehler] = createSignal("");
  onSettled(() => {
    void api<{ offen: boolean }>("/api/v1/erster-inhaber").then((antwort) =>
      antwort.ok ? setOffen(antwort.daten.offen) : setFehler(fehlerText(antwort)),
    );
  });
  const einrichten = async (event: SubmitEvent) => {
    const antwort = await api("/api/v1/erster-inhaber", { body: felder(event) });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    await navigate({ to: "/einrichtung" });
  };
  return (
    <KartenSeite titel={m.erst_titel()} text={m.erst_text()}>
      <Show when={offen() === false}>
        <p>{m.fehler_abgeschlossen()}</p>
        <Link to="/anmelden" class={buttonClass({ variant: "primary" })}>
          {m.erst_zur_anmeldung()}
        </Link>
      </Show>
      <Show when={offen()}>
        <form class="grid gap-4" onSubmit={einrichten}>
          <Input label={m.erst_code()} name="code" autocomplete="off" required />
          <Input label={m.erst_betreiber()} name="betreiber" autocomplete="organization" required />
          <KontoFelder />
          <Fehler text={fehler()} />
          <Button type="submit" variant="primary">
            {m.erst_knopf()}
          </Button>
        </form>
      </Show>
      <Show when={offen() === undefined}>
        <Fehler text={fehler()} />
      </Show>
    </KartenSeite>
  );
};

export const Route = createFileRoute("/erster-inhaber")({ component: ErsterInhaber });
