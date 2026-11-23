import { Button, Icon, m } from "@steuerzentrale/ui";
import { Building2, CalendarX, Pencil, Undo2 } from "@steuerzentrale/ui/icons";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createMemo, createSignal, Loading, Match, refresh, Show, Switch } from "solid-js";
import { loeschungAm, monatVon, supportMinutenAus } from "../daten/ableitungen.ts";
import { desKunden, einmal } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { kundenQuelle } from "../daten/kunden.ts";
import { bestand } from "../daten/quelle.ts";
import { supportQuelle } from "../daten/support.ts";
import type { Kunde } from "../daten/typen.ts";
import { minuten } from "../format/zahl.ts";
import { datum } from "../format/zeit.ts";
import { slaName, slaText, welleName } from "../rahmen/texte.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { InstallationsListe } from "../seiten/installations-liste.tsx";
import { Installieren } from "../seiten/installieren.tsx";
import {
  KuendigungZuruecknehmen,
  KundeAendern,
  KundeIntern,
  KundeKuendigen,
} from "../seiten/kunden-dialoge.tsx";
import { NurInhaber } from "../seiten/recht.tsx";
import { ZielEreignisse } from "../seiten/ziel-ereignisse.tsx";
import { Angaben, Hinweisbox, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { NichtGefunden } from "../teile/nicht-gefunden.tsx";
import { Marke } from "../teile/zeichen.tsx";

/**
 * One customer: contract, contact, its installations and their events (Z-801, Z-406), all from the
 * Zentrale, and the minutes of its support accesses this month (Z-802).
 */

const initialen = (name: string) =>
  name
    .split(" ")
    .map((teil) => teil[0])
    .join("")
    .slice(0, 2);

type Offen = "aendern" | "kuendigen" | "zuruecknehmen" | "intern" | undefined;

/**
 * Install an app for the customer (Z-402), change, give notice, take the notice back: each opens
 * its dialog with a reason
 */
const Aktionen = (props: { k: Kunde; oeffne: (dialog: Offen) => void }) => {
  const navigate = useNavigate();
  return (
    <div class="flex flex-wrap gap-2">
      <Show when={props.k.vertrag.ende === null}>
        <Installieren
          kundeId={props.k.id}
          onAngelegt={(i) =>
            void navigate({ to: "/installationen/$id", params: { id: i.installationId } })
          }
        />
      </Show>
      <Button onClick={() => props.oeffne("aendern")}>
        <Icon icon={Pencil} />
        {m.kunde_aendern()}
      </Button>
      <NurInhaber>
        <Button onClick={() => props.oeffne("intern")}>
          <Icon icon={Building2} />
          {props.k.intern ? m.kunde_intern_aufheben() : m.kunde_intern_markieren()}
        </Button>
      </NurInhaber>
      <Show
        when={props.k.vertrag.ende === null}
        fallback={
          <Button onClick={() => props.oeffne("zuruecknehmen")}>
            <Icon icon={Undo2} />
            {m.kunde_zuruecknehmen()}
          </Button>
        }
      >
        <Show when={!props.k.intern}>
          <Button onClick={() => props.oeffne("kuendigen")}>
            <Icon icon={CalendarX} />
            {m.kunde_kuendigen()}
          </Button>
        </Show>
      </Show>
    </div>
  );
};

const Kopf = (props: { k: Kunde; oeffne: (dialog: Offen) => void }) => (
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex min-w-0 items-center gap-4">
      <span
        aria-hidden="true"
        class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent font-medium"
      >
        {initialen(props.k.name)}
      </span>
      <div class="grid min-w-0 gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight break-words">{props.k.name}</h1>
          <Marke class="bg-accent">{m.kunde_sla({ sla: slaName(props.k.vertrag.sla) })}</Marke>
          <Marke class="bg-accent font-mono">
            {m.kunde_kuerzel_anzeige({ kuerzel: props.k.kuerzel })}
          </Marke>
          <Show when={props.k.intern}>
            <Marke class="bg-accent">{m.kunden_intern()}</Marke>
          </Show>
        </div>
        <p class="text-muted-foreground break-words">
          {m.kunde_kontakt({
            kontakt: props.k.kontakt.email,
            seit: datum(props.k.vertrag.beginn),
          })}
        </p>
      </div>
    </div>
    <Aktionen k={props.k} oeffne={props.oeffne} />
  </div>
);

const VertragsKarte = (props: { k: Kunde; supportMinuten: number }) => (
  <Karte>
    <KartenKopf titel={m.kunde_vertrag()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunden_spalte_sla(), wert: slaName(props.k.vertrag.sla) },
          { name: m.kunde_bedeutet(), wert: slaText(props.k.vertrag.sla) },
          { name: m.inst_welle(), wert: welleName(props.k.intern ? "intern" : "alle") },
          { name: m.kunde_feld_beginn(), wert: datum(props.k.vertrag.beginn) },
          {
            name: m.kunde_feld_ende(),
            wert:
              props.k.vertrag.ende === null ? m.kunde_ungekuendigt() : datum(props.k.vertrag.ende),
          },
          { name: m.kunde_support_monat(), wert: minuten(props.supportMinuten) },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const KontaktKarte = (props: { k: Kunde }) => (
  <Karte>
    <KartenKopf titel={m.kunde_kontakt_titel()} />
    <KartenInhalt>
      <Angaben
        zeilen={[
          { name: m.kunde_feld_ansprechpartner(), wert: props.k.kontakt.name },
          { name: m.anm_email(), wert: props.k.kontakt.email },
          { name: m.kunde_feld_telefon(), wert: props.k.kontakt.telefon ?? "–" },
          { name: m.kunde_feld_notiz(), wert: props.k.notiz ?? "–" },
        ]}
      />
    </KartenInhalt>
  </Karte>
);

const Dialoge = (props: {
  k: Kunde;
  offen: Offen;
  oeffne: (dialog: Offen) => void;
  gespeichert: () => void;
}) => {
  const schliessen = () => props.oeffne(undefined);
  const fertig = () => {
    schliessen();
    props.gespeichert();
  };
  return (
    <>
      <KundeAendern
        open={props.offen === "aendern"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <KundeKuendigen
        open={props.offen === "kuendigen"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <KundeIntern
        open={props.offen === "intern"}
        kunde={props.k}
        onClose={schliessen}
        gespeichert={fertig}
      />
      <Show when={props.k.vertrag.ende}>
        {(ende) => (
          <KuendigungZuruecknehmen
            open={props.offen === "zuruecknehmen"}
            kunde={props.k}
            ende={ende()}
            onClose={schliessen}
            gespeichert={fertig}
          />
        )}
      </Show>
    </>
  );
};

const Detail = (props: { k: Kunde; gespeichert: () => void }) => {
  const b = bestand();
  const [offen, setOffen] = createSignal<Offen>();
  const antwort = createMemo(() => uebersichtLaden());
  const installationen = () => {
    const a = antwort();
    return a.ok ? desKunden(a.daten.installationen, props.k.id) : [];
  };
  // the support accesses to its installations (Z-802): their minutes this month in Berlin
  const zugaenge = createMemo(() => supportQuelle().liste({ kundeId: props.k.id }));
  const supportDiesenMonat = () => {
    const z = zugaenge();
    return z.ok ? supportMinutenAus(z.daten, props.k.id, monatVon(b.jetzt), b.jetzt) : 0;
  };
  return (
    <div class="grid gap-4">
      <Kopf k={props.k} oeffne={setOffen} />
      <Show when={props.k.vertrag.ende}>
        {(ende) => (
          <Hinweisbox
            icon={<Icon icon={CalendarX} />}
            titel={m.kunde_gekuendigt_zum({ datum: datum(ende()) })}
          >
            {m.kunde_gekuendigt_text({ datum: datum(loeschungAm(ende())) })}
          </Hinweisbox>
        )}
      </Show>
      <div class="grid gap-4 lg:grid-cols-2">
        <VertragsKarte k={props.k} supportMinuten={supportDiesenMonat()} />
        <KontaktKarte k={props.k} />
      </div>
      <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
        <Karte>
          <KartenKopf
            titel={m.nav_installationen()}
            text={m.kunde_installationen_text({
              n: installationen().length,
              server: einmal(installationen().map((i) => i.serverId)).length,
            })}
          />
          <KartenInhalt>
            <InstallationsListe installationen={installationen()} zeige="app" />
          </KartenInhalt>
        </Karte>
        <Karte>
          <KartenKopf titel={m.kunde_verlauf()} text={m.kunde_verlauf_text()} />
          <KartenInhalt class="grid gap-4">
            <ZielEreignisse ziele={installationen().map((i) => `installation:${i.id}`)} />
          </KartenInhalt>
        </Karte>
      </Loading>
      <Dialoge k={props.k} offen={offen()} oeffne={setOffen} gespeichert={props.gespeichert} />
    </div>
  );
};

const KundeSeite = () => {
  const params = Route.useParams();
  const antwort = createMemo(() => kundenQuelle().kunde(params().id));
  const kunde = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  const fehlt = () => {
    const a = antwort();
    return !a.ok && a.status === 404;
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Loading fallback={<p class="text-muted-foreground">{m.kunde_laden()}</p>}>
      <Switch fallback={<Fehler text={fehler()} />}>
        <Match when={kunde()}>
          {(k) => <Detail k={k()} gespeichert={() => refresh(antwort)} />}
        </Match>
        <Match when={fehlt()}>
          <NichtGefunden />
        </Match>
      </Switch>
    </Loading>
  );
};

export const Route = createFileRoute("/kunden/$id")({ component: KundeSeite });
