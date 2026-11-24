import { buttonClass, m } from "@steuerzentrale/ui";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { createMemo, Loading } from "solid-js";
import { betriebQuelle, brauchtAufmerksamkeit } from "../daten/betrieb.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { Hinweisliste } from "../seiten/hinweise.tsx";
import { BackupZahl, InstallationenZahl, ServerZahl, UpdateZahl } from "../seiten/kennzahlen.tsx";
import { AuftragTabelle, OFFEN } from "../teile/auftraege.tsx";
import { Karte, KartenInhalt, KartenKopf, Seitenkopf } from "../teile/karte.tsx";
import { Ereignisliste } from "../teile/listen.tsx";

/**
 * The overview (BAULISTE.md Z-406): four key figures, what needs attention worst first as the
 * Zentrale orders it (GET /api/v1/uebersicht), the newest events and the open jobs
 */

/** How many events the overview shows; the rest are on their page */
const NEUESTE = 6;

const laden = () => <p class="text-muted-foreground">{m.uebersicht_laden()}</p>;

const Zahlen = () => {
  const antwort = createMemo(() => uebersichtLaden());
  const daten = () => {
    const a = antwort();
    return a.ok ? a.daten : { installationen: [], server: [] };
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Loading fallback={laden()}>
      <Fehler text={fehler()} />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServerZahl server={daten().server} />
        <InstallationenZahl installationen={daten().installationen} />
        <UpdateZahl />
        <BackupZahl />
      </div>
    </Loading>
  );
};

const Aufmerksamkeit = () => {
  const antwort = createMemo(() => betriebQuelle().uebersicht());
  const eintraege = () => {
    const a = antwort();
    return a.ok ? a.daten : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Karte class="xl:col-span-2">
      <Loading fallback={<KartenInhalt class="pt-5">{laden()}</KartenInhalt>}>
        <KartenKopf
          titel={m.uebersicht_aufmerksamkeit()}
          text={m.uebersicht_aufmerksamkeit_text({ n: brauchtAufmerksamkeit(eintraege()) })}
        />
        <KartenInhalt>
          <Fehler text={fehler()} />
          <Hinweisliste eintraege={eintraege()} />
        </KartenInhalt>
      </Loading>
    </Karte>
  );
};

const NeuesteEreignisse = () => {
  const klein = buttonClass({ variant: "outline", size: "sm" });
  const antwort = createMemo(() => betriebQuelle().ereignisse({}));
  const ereignisse = () => {
    const a = antwort();
    return a.ok ? a.daten.eintraege.slice(0, NEUESTE) : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Karte>
      <KartenKopf
        titel={m.uebersicht_ereignisse()}
        text={m.uebersicht_ereignisse_text()}
        aktion={
          <Link to="/protokoll" search={{ tab: "ereignisse" }} class={klein}>
            {m.uebersicht_alle_ereignisse()}
          </Link>
        }
      />
      <KartenInhalt>
        <Loading fallback={laden()}>
          <Fehler text={fehler()} />
          <Ereignisliste ereignisse={ereignisse()} />
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};

const OffeneAuftraege = () => {
  const klein = buttonClass({ variant: "outline", size: "sm" });
  const antwort = createMemo(() => betriebQuelle().auftraege({ zustand: OFFEN }));
  const auftraege = () => {
    const a = antwort();
    return a.ok ? a.daten.eintraege : [];
  };
  const fehler = () => {
    const a = antwort();
    return a.ok ? "" : fehlerText(a);
  };
  return (
    <Karte class="overflow-hidden">
      <KartenKopf
        titel={m.nav_auftraege()}
        text={m.uebersicht_auftraege_text()}
        aktion={
          <Link to="/protokoll" search={{ tab: "auftraege" }} class={klein}>
            {m.uebersicht_alle_auftraege()}
          </Link>
        }
      />
      <div class="border-t">
        <Loading fallback={<KartenInhalt class="pt-5">{laden()}</KartenInhalt>}>
          <Fehler text={fehler()} />
          <AuftragTabelle
            name={m.uebersicht_auftraege_tabelle()}
            rahmen={false}
            auftraege={auftraege()}
          />
        </Loading>
      </div>
    </Karte>
  );
};

const Uebersicht = () => (
  <div class="grid gap-4">
    <Seitenkopf titel={m.nav_uebersicht()} text={m.uebersicht_text()} />
    <Zahlen />
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Aufmerksamkeit />
      <NeuesteEreignisse />
    </div>
    <OffeneAuftraege />
  </div>
);

export const Route = createFileRoute("/")({ component: Uebersicht });
