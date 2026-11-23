import { m } from "@steuerzentrale/ui";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import { benachrichtigungsQuelle, type Zustellung } from "../daten/benachrichtigungen.ts";
import { bestand } from "../daten/quelle.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Fehler } from "./anmeldung-teile.tsx";
import { EmpfaengerListe, schwereText } from "./einstellungen-empfaenger.tsx";
import { fehlerText, VersandFormular, VersandLesen } from "./einstellungen-versand.tsx";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The settings' tab "Benachrichtigungen" (BAULISTE.md Z-703; mockup viewEinstellungen, "melden";
 * docs/benachrichtigungen.md): mail server and quiet hours, the recipients and the newest
 * deliveries, from GET /api/v1/benachrichtigungen. One message per fault, not per check.
 */

const ZUSTAND: Record<Zustellung["zustand"], () => string> = {
  wartet: m.melden_zustand_wartet,
  zugestellt: m.melden_zustand_zugestellt,
  aufgegeben: m.melden_zustand_aufgegeben,
};

const zustandText = (z: Zustellung, jetzt: number) => {
  const versuche = m.melden_versuche({ anzahl: z.versuche });
  if (z.zustand !== "wartet") return `${ZUSTAND[z.zustand]()} · ${versuche}`;
  return `${ZUSTAND.wartet()} · ${versuche} · ${m.melden_naechster({ zeit: zeitpunkt(z.faelligAm, jetzt) })}`;
};

const Zustellungen = (props: { liste: Zustellung[] }) => (
  <Tabelle
    name={m.melden_zustellungen()}
    rahmen={false}
    minBreite={720}
    leer={m.melden_zustellungen_keine()}
    anzahl={props.liste.length}
    spalten={[
      { name: m.melden_zeit() },
      { name: m.melden_ereignis() },
      { name: m.melden_adresse() },
      { name: m.melden_zustand() },
    ]}
  >
    <For each={props.liste}>
      {(z) => (
        <Reihe>
          <td class="text-xs whitespace-nowrap text-muted-foreground">
            {zeitpunkt(z.angelegtAm, bestand().jetzt)}
          </td>
          <td class="text-xs">
            <span class="font-medium">{schwereText(z.schwere)}</span> {z.ereignisText ?? "–"}
          </td>
          <td class="font-mono text-xs">{z.empfaenger ?? "–"}</td>
          <td class="text-xs">
            {zustandText(z, bestand().jetzt)}
            <Show when={z.fehler}>
              <span class="block font-mono text-danger">{z.fehler}</span>
            </Show>
          </td>
        </Reihe>
      )}
    </For>
  </Tabelle>
);

export const Benachrichtigungen = () => {
  const antwort = createMemo(() => benachrichtigungsQuelle().lesen());
  const [hinweis, setHinweis] = createSignal("");
  const gelesen = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  const geaendert = (text: string) => {
    setHinweis(text);
    refresh(antwort);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
      <div class="grid gap-4">
        <Fehler text={fehlerText(antwort())} />
        <p role="status" class="text-xs text-muted-foreground">
          {hinweis()}
        </p>
        <Show when={gelesen()}>
          {(b) => (
            <>
              <Karte>
                <KartenKopf titel={m.einst_melden()} text={m.einst_melden_text()} />
                <KartenInhalt class="grid gap-4">
                  <MitInstallationsRecht sonst={<VersandLesen b={b()} />}>
                    <VersandFormular
                      b={b()}
                      gespeichert={() => geaendert(m.melden_gespeichert())}
                    />
                  </MitInstallationsRecht>
                </KartenInhalt>
              </Karte>
              <Karte>
                <KartenKopf titel={m.melden_empfaenger()} text={m.melden_empfaenger_text()} />
                <KartenInhalt>
                  <EmpfaengerListe liste={b().empfaenger} geaendert={geaendert} />
                </KartenInhalt>
              </Karte>
              <Karte class="overflow-hidden">
                <KartenKopf titel={m.melden_zustellungen()} text={m.melden_zustellungen_text()} />
                <div class="border-t">
                  <Zustellungen liste={b().zustellungen} />
                </div>
              </Karte>
            </>
          )}
        </Show>
      </div>
    </Loading>
  );
};
