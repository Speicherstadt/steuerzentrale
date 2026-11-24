import { Icon, m } from "@steuerzentrale/ui";
import { SquareTerminal, Timer } from "@steuerzentrale/ui/icons";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Loading, refresh, Show } from "solid-js";
import { zugangsMinuten } from "../daten/ableitungen.ts";
import { titelVon } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { bestand } from "../daten/quelle.ts";
import { supportQuelle } from "../daten/support.ts";
import type { Zugang } from "../daten/typen.ts";
import { minuten } from "../format/zahl.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { installationsRecht } from "../seiten/recht.tsx";
import {
  restMinuten,
  type Wahl,
  wasGeschah,
  ZugangBeenden,
  ZugangStarten,
} from "../seiten/support-zugang.tsx";
import { Balken } from "../teile/balken.tsx";
import { Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { KundenReiter } from "../teile/reiter-links.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { ZuInstallation } from "../teile/verweise.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * Time-limited access to an installation, with a reason, logged (BAULISTE.md Z-802; mockup,
 * "Support-Zugänge"): the running ones with their time left, the ended ones with what happened, and
 * "Zugang starten". Its holder ends an access, owner and technik also another's.
 */

type Titel = (installationId: string) => string;

const Aktiv = (props: { z: Zugang; titel: Titel; darfAlle: boolean; neu: () => void }) => {
  const jetzt = () => bestand().jetzt;
  const dauer = () => props.z.endetAm - props.z.beginn;
  const verbraucht = () => Math.round(((jetzt() - props.z.beginn) / dauer()) * 100);
  return (
    <Karte>
      <KartenKopf
        titel={props.titel(props.z.installationId)}
        text={m.sup_wer_seit({
          wer: props.z.nutzer.name,
          seit: zeitpunkt(props.z.beginn, jetzt()),
        })}
        aktion={
          <Marke class="tabular-nums">
            <Icon icon={Timer} size={14} />
            {m.sup_rest({ minuten: restMinuten(props.z, jetzt()) })}
          </Marke>
        }
      />
      <KartenInhalt>
        <p>
          <span class="text-muted-foreground">{m.sup_grund()}</span> {props.z.grund}
        </p>
        <Balken
          name={m.sup_verbraucht({ id: props.z.zugangId })}
          wert={verbraucht()}
          class="mt-3"
        />
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <ZuInstallation
            id={props.z.installationId}
            class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
          >
            <Icon icon={SquareTerminal} />
            {m.sup_zur_installation()}
          </ZuInstallation>
          <Show when={props.z.eigen || props.darfAlle}>
            <ZugangBeenden zugang={props.z} beendet={() => props.neu()} />
          </Show>
        </div>
      </KartenInhalt>
    </Karte>
  );
};

const Beendete = (props: { zugaenge: Zugang[]; titel: Titel }) => (
  <Karte class="overflow-hidden">
    <KartenKopf titel={m.sup_beendet()} />
    <div class="border-t">
      <Tabelle
        name={m.sup_beendet()}
        rahmen={false}
        minBreite={800}
        leer={m.sup_keine_beendet()}
        anzahl={props.zugaenge.length}
        spalten={[
          { name: m.bak_spalte_installation() },
          { name: m.sup_spalte_wer() },
          { name: m.sup_spalte_grund() },
          { name: m.auftraege_spalte_start() },
          { name: m.sup_spalte_dauer() },
          { name: m.sup_spalte_ergebnis() },
        ]}
      >
        <For each={props.zugaenge}>
          {(z) => (
            <Reihe>
              <td>
                <ZuInstallation id={z.installationId}>
                  {props.titel(z.installationId)}
                </ZuInstallation>
              </td>
              <td class="text-xs">{z.nutzer.name}</td>
              <td class="text-xs">{z.grund}</td>
              <td class="text-xs tabular-nums">{zeitpunkt(z.beginn, bestand().jetzt)}</td>
              <td class="text-xs tabular-nums">{minuten(zugangsMinuten(z, bestand().jetzt))}</td>
              <td class="text-xs text-muted-foreground">{wasGeschah(z)}</td>
            </Reihe>
          )}
        </For>
      </Tabelle>
    </div>
  </Karte>
);

const Liste = (props: { zugaenge: Zugang[]; wahl: Wahl[]; neu: () => void }) => {
  const darfAlle = installationsRecht();
  const titel: Titel = (id) => props.wahl.find((w) => w.id === id)?.titel ?? id;
  const aktiv = () => props.zugaenge.filter((z) => z.aktiv);
  return (
    <>
      <div class="mt-2 grid gap-4 lg:grid-cols-2">
        <For
          each={aktiv()}
          fallback={
            <Karte>
              <KartenInhalt class="pt-5">
                <p class="text-muted-foreground">{m.sup_keiner()}</p>
              </KartenInhalt>
            </Karte>
          }
        >
          {(z) => <Aktiv z={z} titel={titel} darfAlle={darfAlle()} neu={() => props.neu()} />}
        </For>
      </div>
      <Beendete zugaenge={props.zugaenge.filter((z) => !z.aktiv)} titel={titel} />
    </>
  );
};

const Support = () => {
  const antwort = createMemo(() => supportQuelle().liste());
  const installationen = createMemo(() => uebersichtLaden());
  const wahl = (): Wahl[] => {
    const a = installationen();
    return a.ok
      ? a.daten.installationen
          .filter((i) => i.zustand !== "entfernt")
          .map((i) => ({ id: i.id, titel: titelVon(i) }))
      : [];
  };
  const zugaenge = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  const neu = () => refresh(antwort);
  return (
    <div class="grid gap-4">
      <Seitenkopf
        titel={m.nav_support()}
        text={m.sup_text()}
        aktion={
          <Loading fallback={null}>
            <ZugangStarten installationen={wahl()} gestartet={neu} />
          </Loading>
        }
      />
      <KundenReiter />
      <Loading fallback={<p class="text-muted-foreground">{m.sup_laden()}</p>}>
        <Show when={antwort().ok} fallback={<Fehler text={fehler()} />}>
          <Liste zugaenge={zugaenge()} wahl={wahl()} neu={neu} />
        </Show>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/support")({ component: Support });
