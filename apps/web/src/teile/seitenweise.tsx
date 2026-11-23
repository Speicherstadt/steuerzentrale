import type { JSX } from "@solidjs/web";
import { Button, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, Loading, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import type { Seite } from "../daten/betrieb.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";

/**
 * A list the Zentrale hands out page by page (BAULISTE.md Z-406): the first page under `Loading`,
 * then "Mehr laden" asks for the next with the cursor of the last one read, until there is none.
 * `zeigen` renders the entries read so far and is called once with their accessor.
 */
export const Seitenweise = <T,>(props: {
  laden: (weiter?: string) => Promise<Antwort<Seite<T>>>;
  ladenText: string;
  zeigen: (eintraege: () => T[]) => JSX.Element;
}) => {
  const erste = createMemo(() => props.laden());
  const [weitere, setWeitere] = createSignal<Seite<T>[]>([]);
  const [laedt, setLaedt] = createSignal(false);
  const [mehrFehler, setMehrFehler] = createSignal("");
  const eintraege = () => {
    const a = erste();
    return a.ok ? [...a.daten.eintraege, ...weitere().flatMap((s) => s.eintraege)] : [];
  };
  const weiter = () => {
    const a = erste();
    if (!a.ok) return null;
    const letzte = weitere().at(-1);
    return letzte ? letzte.weiter : a.daten.weiter;
  };
  const fehler = () => {
    const a = erste();
    return a.ok ? mehrFehler() : fehlerText(a);
  };
  const mehr = async () => {
    const ab = weiter();
    if (!ab || laedt()) return;
    setLaedt(true);
    const a = await props.laden(ab);
    if (a.ok) setWeitere((s) => [...s, a.daten]);
    setMehrFehler(a.ok ? "" : fehlerText(a));
    setLaedt(false);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{props.ladenText}</p>}>
      <Fehler text={fehler()} />
      {props.zeigen(eintraege)}
      <Show when={weiter()}>
        <div>
          <Button variant="outline" size="sm" onClick={() => void mehr()} disabled={laedt()}>
            {laedt() ? m.liste_laedt() : m.liste_mehr()}
          </Button>
        </div>
      </Show>
    </Loading>
  );
};
