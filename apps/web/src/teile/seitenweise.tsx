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
  // the pages read on, with the first page they follow: when what is read changes, the first page
  // is a new answer and the pages of the list before (and one still on its way) no longer count
  const [weitere, setWeitere] = createSignal<{
    zu: Antwort<Seite<T>> | undefined;
    seiten: Seite<T>[];
    fehler: string;
  }>({ zu: undefined, seiten: [], fehler: "" });
  const [laedt, setLaedt] = createSignal(false);
  const dazu = () => {
    const w = weitere();
    return w.zu === erste() ? w : { seiten: [], fehler: "" };
  };
  const eintraege = () => {
    const a = erste();
    return a.ok ? [...a.daten.eintraege, ...dazu().seiten.flatMap((s) => s.eintraege)] : [];
  };
  const weiter = () => {
    const a = erste();
    if (!a.ok) return null;
    const letzte = dazu().seiten.at(-1);
    return letzte ? letzte.weiter : a.daten.weiter;
  };
  const fehler = () => {
    const a = erste();
    return a.ok ? dazu().fehler : fehlerText(a);
  };
  const mehr = async () => {
    const zu = erste();
    const ab = weiter();
    if (!ab || laedt()) return;
    setLaedt(true);
    const a = await props.laden(ab);
    setWeitere((w) => {
      const seiten = w.zu === zu ? w.seiten : [];
      return {
        zu,
        seiten: a.ok ? [...seiten, a.daten] : seiten,
        fehler: a.ok ? "" : fehlerText(a),
      };
    });
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
