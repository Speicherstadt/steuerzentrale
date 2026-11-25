import { Button, Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, For, Loading, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type Betriebsart, betriebsartLesen, betriebsartSetzen } from "../daten/betriebsart.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { NurInhaber } from "./recht.tsx";

/*
 * The settings' tab "Betriebsart" (BAULISTE.md Z-805; docs/einstellungen.md): "Nur für mich" or
 * "Für Kunden". Only the owner changes it, with a reason that goes into the audit log; a member sees it
 * read-only. In the demo the same form is the switch between both kinds.
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.betriebsart_fehler_ungueltig,
  fremde_installationen: m.betriebsart_fehler_fremde,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

const fehlerText = (a: Antwort<unknown>) =>
  a.ok ? "" : (FEHLER[a.fehler] ?? m.fehler_unbekannt)();

export const ARTEN: { wert: Betriebsart; name: () => string; text: () => string }[] = [
  { wert: "selbst", name: m.betriebsart_selbst, text: m.betriebsart_selbst_text },
  { wert: "kunden", name: m.betriebsart_kunden, text: m.betriebsart_kunden_text },
];

const artName = (art: Betriebsart | null) =>
  ARTEN.find((a) => a.wert === art)?.name() ?? m.betriebsart_offen();

const Formular = (props: { art: Betriebsart | null; gespeichert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await betriebsartSetzen(
      werte.betriebsart === "selbst" ? "selbst" : "kunden",
      werte.grund ?? "",
    );
    setLaeuft(false);
    setFehler(fehlerText(antwort));
    if (antwort.ok) props.gespeichert();
  };
  return (
    <form class="grid max-w-xl gap-4" onSubmit={senden}>
      <fieldset class="grid gap-2">
        <legend class="mb-1 text-sm font-medium">{m.betriebsart_titel()}</legend>
        <For each={ARTEN}>
          {(a) => (
            <label class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
              <input
                type="radio"
                name="betriebsart"
                value={a.wert}
                checked={props.art === a.wert}
                required
                class="mt-1"
              />
              <span class="grid gap-0.5">
                <span class="font-medium">{a.name()}</span>
                <span class="text-xs text-muted-foreground">{a.text()}</span>
              </span>
            </label>
          )}
        </For>
      </fieldset>
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.betriebsart_grund_platzhalter()}
        hint={m.feld_grund_hinweis()}
      />
      <Fehler text={fehler()} />
      <div class="flex justify-end">
        <Button type="submit" variant="primary" disabled={laeuft()}>
          {m.knopf_speichern()}
        </Button>
      </div>
    </form>
  );
};

export const BetriebsartReiter = () => {
  const antwort = createMemo(() => betriebsartLesen());
  const [hinweis, setHinweis] = createSignal("");
  const art = () => {
    const a = antwort();
    return a.ok ? a.daten.betriebsart : null;
  };
  return (
    <Karte>
      <KartenKopf titel={m.betriebsart_titel()} text={m.betriebsart_text()} />
      <KartenInhalt class="grid gap-4">
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <Fehler text={fehlerText(antwort())} />
          <p role="status" class="text-xs text-muted-foreground">
            {hinweis()}
          </p>
          <Show when={antwort().ok}>
            <NurInhaber
              sonst={<Angaben zeilen={[{ name: m.betriebsart_titel(), wert: artName(art()) }]} />}
            >
              <Formular art={art()} gespeichert={() => setHinweis(m.betriebsart_gespeichert())} />
            </NurInhaber>
          </Show>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};
