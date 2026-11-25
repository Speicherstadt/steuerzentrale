import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { CalendarX } from "@steuerzentrale/ui/icons";
import { createMemo, createSignal, For, Loading, refresh, Show } from "solid-js";
import type { Fehlschlag } from "../anmeldung/api.ts";
import {
  type Abwicklung,
  type ArchivLinks,
  abwicklungQuelle,
  type Schritt,
} from "../daten/abwicklung.ts";
import { type InstallationAnsicht, titelVon } from "../daten/installation-ansicht.ts";
import { speicher } from "../format/zahl.ts";
import { datum, zeitpunkt } from "../format/zeit.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";
import { installationsRecht } from "./recht.tsx";

/*
 * What follows the contract's end of an installation (BAULISTE.md Z-604; docs/kunden.md,
 * "Kündigung"): the deadlines, where it stands, the archive for the customer and, once deleted,
 * the deletion log; for the owner within the 30 days the link to the archive, made with a
 * reason and shown only here, once. Nothing while the contract has no end.
 */

const SCHRITT: Record<Schritt, () => string> = {
  archiv: m.abw_schritt_archiv,
  warten: m.abw_schritt_warten,
  loeschen: m.abw_schritt_loeschen,
  repository: m.abw_schritt_repository,
  zugang: m.abw_schritt_zugang,
  dns: m.abw_schritt_dns,
  geloescht: m.abw_schritt_laeuft,
};

const FEHLER: Record<string, () => string> = {
  kein_archiv: m.abw_fehler_kein_archiv,
  frist_abgelaufen: m.abw_fehler_frist_abgelaufen,
  kein_zugang: m.abw_fehler_kein_zugang,
};

const fehlerVon = (f: Fehlschlag) => (FEHLER[f.fehler] ?? (() => fehlerText(f)))();

const standText = (d: Abwicklung) => {
  if (d.geloeschtAm !== null) return m.abw_schritt_geloescht({ datum: datum(d.geloeschtAm) });
  return d.schritt === null ? m.abw_schritt_laeuft() : SCHRITT[d.schritt]();
};

const archivText = (d: Abwicklung) => {
  if (!d.archiv) return m.abw_archiv_keins();
  const bytes = d.archiv.objekte.reduce((s, o) => s + o.bytes, 0);
  return m.abw_archiv_dateien({
    anzahl: d.archiv.objekte.length,
    groesse: speicher(bytes / 1024 ** 2),
  });
};

const zeilen = (d: Abwicklung) => [
  ...(d.vertragsende === null ? [] : [{ name: m.abw_vertragsende(), wert: datum(d.vertragsende) }]),
  ...(d.nurLesenBis === null ? [] : [{ name: m.abw_nur_lesen_bis(), wert: datum(d.nurLesenBis) }]),
  ...(d.loeschenAb === null ? [] : [{ name: m.abw_loeschung_am(), wert: datum(d.loeschenAb) }]),
  { name: m.abw_stand(), wert: standText(d) },
  { name: m.abw_archiv(), wert: archivText(d) },
  ...(d.linkBis === null ? [] : [{ name: m.abw_link_bis(), wert: datum(d.linkBis) }]),
];

const LinkDialog = (props: {
  a: InstallationAnsicht;
  open: boolean;
  onClose: () => void;
  erzeugt: (l: ArchivLinks) => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await abwicklungQuelle().link(props.a.id, werte.grund ?? "");
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort));
    setFehler("");
    props.erzeugt(antwort.daten);
  };
  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={m.abw_link_knopf()}
      description={m.abw_link_text({ name: titelVon(props.a) })}
    >
      <Show when={props.open}>
        <form class="grid gap-4" onSubmit={senden}>
          <Input
            label={m.feld_grund()}
            name="grund"
            required
            maxlength={500}
            placeholder={m.abw_link_grund_platzhalter()}
            hint={m.feld_grund_hinweis()}
          />
          <Fehler text={fehler()} />
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => props.onClose()}>{m.knopf_abbrechen()}</Button>
            <Button type="submit" variant="primary" disabled={laeuft()}>
              {m.abw_link_erzeugen()}
            </Button>
          </div>
        </form>
      </Show>
    </Dialog>
  );
};

/** The links just made: each file with its link, and until when they work */
const Links = (props: { l: ArchivLinks }) => (
  <div class="grid gap-2 border-t px-5 py-4" role="status">
    <p class="text-xs text-muted-foreground">
      {m.abw_link_gueltig({ datum: datum(props.l.gueltigBis) })}
    </p>
    <ul class="grid gap-2">
      <For each={props.l.links}>
        {(l) => (
          <li class="grid gap-1">
            <span class="text-xs font-medium">{l.datei}</span>
            <a href={l.url} class="font-mono text-xs break-all underline" rel="noreferrer">
              {l.url}
            </a>
          </li>
        )}
      </For>
    </ul>
  </div>
);

const Protokoll = (props: { d: Abwicklung; jetzt: number }) => (
  <div class="grid gap-2 border-t px-5 py-4">
    <h3 class="text-sm font-semibold">{m.abw_protokoll()}</h3>
    <ol class="grid gap-1 font-mono text-xs">
      <For each={props.d.protokoll}>
        {(e) => (
          <li>
            {zeitpunkt(e.zeitpunkt, props.jetzt)} · {e.schritt}: {e.detail}
          </li>
        )}
      </For>
    </ol>
  </div>
);

export const InstallationAbwicklung = (props: { a: InstallationAnsicht; jetzt: number }) => {
  const antwort = createMemo(() => abwicklungQuelle().lesen(props.a.id));
  const darf = installationsRecht();
  const [offen, setOffen] = createSignal(false);
  const [links, setLinks] = createSignal<ArchivLinks | undefined>();
  const daten = () => {
    const r = antwort();
    return r.ok && (r.daten.vertragsende !== null || r.daten.schritt !== null)
      ? r.daten
      : undefined;
  };
  const linkAngeboten = (d: Abwicklung) => darf() && d.phase === "nur_lesen" && d.archiv !== null;
  return (
    <Loading fallback={null}>
      <Show when={daten()}>
        {(d) => (
          <Karte class="overflow-hidden">
            <KartenKopf
              titel={m.abw_titel()}
              text={m.abw_text()}
              aktion={
                <Show when={linkAngeboten(d())}>
                  <Button onClick={() => setOffen(true)}>
                    <Icon icon={CalendarX} />
                    {m.abw_link_knopf()}
                  </Button>
                </Show>
              }
            />
            <KartenInhalt>
              <Angaben zeilen={zeilen(d())} />
            </KartenInhalt>
            <Show when={links()}>{(l) => <Links l={l()} />}</Show>
            <Show when={d().protokoll.length > 0 && d().geloeschtAm !== null}>
              <Protokoll d={d()} jetzt={props.jetzt} />
            </Show>
            <LinkDialog
              a={props.a}
              open={offen()}
              onClose={() => setOffen(false)}
              erzeugt={(l) => {
                setOffen(false);
                setLinks(l);
                refresh(antwort);
              }}
            />
          </Karte>
        )}
      </Show>
    </Loading>
  );
};
