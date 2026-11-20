import { Button, buttonClass, m } from "@steuerzentrale/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import { abmelden, type Einrichtung, einrichtungLesen } from "../anmeldung/sitzung.ts";
import { KartenSeite } from "../seiten/anmeldung-teile.tsx";
import { PasskeyKarte, TotpKarte } from "../seiten/zweiter-faktor.tsx";

/**
 * The setup of the second factor (docs/plan.md, "Anmeldung an der Zentrale"): the only page an
 * account reaches without it. A passkey is enough; with a password TOTP is required.
 */
const EinrichtungSeite = () => {
  const navigate = useNavigate();
  const [stand, setStand] = createSignal<Einrichtung | "abgemeldet">();
  const laden = async () => {
    const antwort = await einrichtungLesen();
    setStand(antwort.ok ? antwort.daten : "abgemeldet");
  };
  onSettled(() => {
    void laden();
  });
  const raus = async () => {
    await abmelden();
    await navigate({ to: "/anmelden" });
  };
  const daten = () => {
    const s = stand();
    return s && s !== "abgemeldet" ? s : undefined;
  };
  return (
    <KartenSeite titel={m.einr_titel()} text={m.einr_text()}>
      <Show when={stand() === "abgemeldet"}>
        <p>{m.einr_abgemeldet()}</p>
        <Link to="/anmelden" class={buttonClass({ variant: "primary" })}>
          {m.erst_zur_anmeldung()}
        </Link>
      </Show>
      <Show when={daten()}>
        {(d) => (
          <div class="grid gap-4">
            <Show when={d().zweiterFaktor}>
              <p role="status" class="font-medium">
                {m.einr_fertig()}
              </p>
              <Link to="/" class={buttonClass({ variant: "primary" })}>
                {m.einr_weiter()}
              </Link>
            </Show>
            <Show
              when={d().passwort}
              fallback={<p class="text-muted-foreground">{m.einr_totp_ohne_passwort()}</p>}
            >
              <TotpKarte verbunden={d().totp} fertig={laden} />
            </Show>
            <PasskeyKarte
              anzahl={d().passkeys}
              mitPasswort={d().passwort}
              totp={d().totp}
              fertig={laden}
            />
            <Button variant="ghost" onClick={raus}>
              {m.abmelden()}
            </Button>
          </div>
        )}
      </Show>
    </KartenSeite>
  );
};

export const Route = createFileRoute("/einrichtung")({ component: EinrichtungSeite });
