import { Button, m } from "@steuerzentrale/ui";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import { api } from "../anmeldung/api.ts";
import {
  Fehler,
  fehlerText,
  felder,
  KartenSeite,
  ROLLEN_TEXT,
} from "../seiten/anmeldung-teile.tsx";
import { KontoFelder } from "../seiten/konto-felder.tsx";

type Einladung = { betreiber: string; rolle: string; gueltigBis: number };

/**
 * Accepting an invitation (docs/anmeldung.md): the token stands after the `#` of the link, so it
 * reaches no server log; the page sends it in the body. Then on to the second factor.
 */
const EinladungSeite = () => {
  const navigate = useNavigate();
  const [einladung, setEinladung] = createSignal<Einladung>();
  const [fehler, setFehler] = createSignal("");
  const token = () => location.hash.slice(1);
  onSettled(() => {
    void api<Einladung>("/api/v1/einladung/ansehen", { body: { token: token() } }).then(
      (antwort) => (antwort.ok ? setEinladung(antwort.daten) : setFehler(fehlerText(antwort))),
    );
  });
  const annehmen = async (event: SubmitEvent) => {
    const antwort = await api("/api/v1/einladung/annehmen", {
      body: { ...felder(event), token: token() },
    });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    await navigate({ to: "/einrichtung" });
  };
  return (
    <KartenSeite titel={m.einl_titel()}>
      <Show
        when={einladung()}
        fallback={
          <Show when={!fehler()}>
            <p class="text-muted-foreground">{m.einl_pruefen()}</p>
          </Show>
        }
      >
        {(e) => (
          <form class="grid gap-4" onSubmit={annehmen}>
            <p>
              {m.einl_text({
                betreiber: e().betreiber,
                rolle: (ROLLEN_TEXT[e().rolle] ?? (() => e().rolle))(),
              })}
            </p>
            <KontoFelder />
            <Button type="submit" variant="primary">
              {m.einl_knopf()}
            </Button>
          </form>
        )}
      </Show>
      <Fehler text={fehler()} />
    </KartenSeite>
  );
};

export const Route = createFileRoute("/einladung")({ component: EinladungSeite });
