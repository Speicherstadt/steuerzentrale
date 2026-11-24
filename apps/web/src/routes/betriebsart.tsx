import { buttonClass, Icon, m } from "@steuerzentrale/ui";
import { Building2, User } from "@steuerzentrale/ui/icons";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import { type Betriebsart, betriebsartLesen, betriebsartSetzen } from "../daten/betriebsart.ts";
import { Fehler, fehlerText, KartenSeite } from "../seiten/anmeldung-teile.tsx";
import { ARTEN } from "../seiten/einstellungen-betriebsart.tsx";

/**
 * The question after the first owner (BAULISTE.md Z-805; docs/anmeldung.md): "Nur für mich" or
 * "Für Kunden". The root route sends the owner here before every page of the shell until it is
 * answered; later the owner changes it under Einstellungen with a reason.
 */
const ICONS = { selbst: User, kunden: Building2 } as const;

const Auswahl = () => {
  const navigate = useNavigate();
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const waehlen = async (art: Betriebsart) => {
    setLaeuft(true);
    const antwort = await betriebsartSetzen(art);
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    await navigate({ to: "/" });
  };
  return (
    <>
      <div class="grid gap-3">
        <For each={ARTEN}>
          {(a) => (
            <button
              type="button"
              disabled={laeuft()}
              class="flex items-start gap-3 rounded-lg border p-4 text-left hover:bg-accent disabled:opacity-50"
              onClick={() => waehlen(a.wert)}
            >
              <Icon icon={ICONS[a.wert]} class="mt-0.5 shrink-0 text-muted-foreground" />
              <span class="grid gap-0.5">
                <span class="font-medium">{a.name()}</span>
                <span class="text-xs text-muted-foreground">{a.text()}</span>
              </span>
            </button>
          )}
        </For>
      </div>
      <p class="text-xs text-muted-foreground">{m.betriebsart_frage_spaeter()}</p>
      <Fehler text={fehler()} />
    </>
  );
};

/** Once answered the page only names the answer and points to the settings */
const Frage = () => {
  const antwort = createMemo(() => betriebsartLesen());
  const gewaehlt = () => {
    const a = antwort();
    return a.ok ? a.daten.betriebsart : null;
  };
  return (
    <KartenSeite titel={m.betriebsart_frage()} text={m.betriebsart_frage_text()}>
      <Loading fallback={null}>
        <Show when={gewaehlt()} fallback={<Auswahl />}>
          {(art) => (
            <>
              <p>
                {m.betriebsart_schon({ art: ARTEN.find((a) => a.wert === art())?.name() ?? "" })}
              </p>
              <Link
                to="/einstellungen"
                search={{ tab: "betriebsart" }}
                class={buttonClass({ variant: "primary" })}
              >
                {m.betriebsart_zu_einstellungen()}
              </Link>
            </>
          )}
        </Show>
      </Loading>
    </KartenSeite>
  );
};

export const Route = createFileRoute("/betriebsart")({ component: Frage });
