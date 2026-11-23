import type { MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import { ChartNoAxesColumn, Globe, Lock, Radar } from "@steuerzentrale/ui/icons";
import { createMemo, For, Loading, Show } from "solid-js";
import {
  type AussenDerInstallation,
  type AussenDerZentrale,
  aussenGrundText,
  aussenQuelle,
  monatSchluessel,
  prozentVon,
  ZIEL_PROZENT,
} from "../daten/aussen.ts";
import { bestand } from "../daten/quelle.ts";
import { ZERTIFIKAT_TAGE } from "../daten/zustand.ts";
import { prozent, zahl } from "../format/zahl.ts";
import { datum, monatName, zeitpunkt } from "../format/zeit.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Pruefzeile } from "../teile/listen.tsx";
import { Reihe, Tabelle } from "../teile/tabelle.tsx";
import { Fehler, fehlerText } from "./anmeldung-teile.tsx";

/*
 * The address of an installation and its check from outside (BAULISTE.md Z-704; mockup,
 * installation page, card "Adresse und Prüfung von außen"): where the name points, the Pforte's
 * certificate, what the health path answered through the public host, and the availability of the
 * current month; below it every month of the last 13 that was measured. Read anew whenever the
 * page is.
 */

const TAG = 86_400_000;

const DNS_CODES = new Set(["dns", "dns_abweichung"]);

const dnsZeile = (host: string, a: AussenDerZentrale | null) => {
  if (!a) return { detail: host, ok: null };
  if (DNS_CODES.has(a.grund.code)) return { detail: aussenGrundText(a.grund), ok: false };
  const d = a.ergebnis.dns;
  return { detail: `${host} → ${d.ok ? [...d.a, ...d.aaaa].join(", ") : ""}`, ok: d.ok };
};

const zertifikatZeile = (a: AussenDerZentrale | null, jetzt: number) => {
  const t = a?.ergebnis.tls;
  if (!a || !t) return { detail: "–", ok: null };
  if (!t.ok) return { detail: aussenGrundText(a.grund), ok: false };
  const tage = Math.floor((t.gueltigBis - jetzt) / TAG);
  return {
    detail: m.aussen_zertifikat_bis({ datum: datum(t.gueltigBis), tage: zahl(tage) }),
    ok: tage > ZERTIFIKAT_TAGE,
  };
};

const vonAussenZeile = (a: AussenDerZentrale | null, jetzt: number) =>
  a
    ? {
        detail: m.aussen_seit({ grund: aussenGrundText(a.grund), zeit: zeitpunkt(a.seit, jetzt) }),
        ok: a.zustand === "unbekannt" ? null : a.zustand === "gruen",
      }
    : { detail: m.aussen_noch_nicht(), ok: null };

const verfuegbarText = (v: MonatsVerfuegbarkeit) => {
  const p = prozentVon(v);
  return p === undefined ? m.aussen_nicht_gemessen() : prozent(p, 2);
};

const Pruefungen = (props: { host: string; d: AussenDerInstallation }) => {
  const jetzt = () => bestand().jetzt;
  const monat = () => props.d.verfuegbarkeit[0];
  const dns = () => dnsZeile(props.host, props.d.aussen);
  const zertifikat = () => zertifikatZeile(props.d.aussen, jetzt());
  const aussen = () => vonAussenZeile(props.d.aussen, jetzt());
  return (
    <KartenInhalt class="grid gap-3 sm:grid-cols-2">
      <Pruefzeile icon={Globe} name={m.inst_dns()} detail={dns().detail} ok={dns().ok} />
      <Pruefzeile
        icon={Lock}
        name={m.inst_zertifikat()}
        detail={zertifikat().detail}
        ok={zertifikat().ok}
      />
      <Pruefzeile
        icon={Radar}
        name={m.inst_von_aussen()}
        detail={aussen().detail}
        ok={aussen().ok}
      />
      <Show when={monat()}>
        {(v) => (
          <Pruefzeile
            icon={ChartNoAxesColumn}
            name={m.aussen_verfuegbarkeit_monat({ monat: monatName(monatSchluessel(v())) })}
            detail={verfuegbarText(v())}
            ok={v().anteil === null ? null : (prozentVon(v()) ?? 0) >= ZIEL_PROZENT}
          />
        )}
      </Show>
    </KartenInhalt>
  );
};

/** Every month of the last 13 with a check, newest first */
const Monate = (props: { monate: MonatsVerfuegbarkeit[] }) => {
  const gemessen = () => props.monate.filter((v) => v.gemessen > 0);
  return (
    <div class="border-t" data-testid="verfuegbarkeit">
      <KartenKopf titel={m.aussen_monate()} text={m.aussen_monate_text()} />
      <Tabelle
        name={m.aussen_monate()}
        rahmen={false}
        minBreite={360}
        leer={m.aussen_monate_leer()}
        anzahl={gemessen().length}
        spalten={[
          { name: m.aussen_spalte_monat() },
          { name: m.inst_verfuegbarkeit(), class: "text-right" },
          { name: m.aussen_spalte_gemessen(), class: "text-right" },
        ]}
      >
        <For each={gemessen()}>
          {(v) => (
            <Reihe>
              <td>{monatName(monatSchluessel(v))}</td>
              <td class="text-right font-mono text-xs tabular-nums">{verfuegbarText(v)}</td>
              <td class="text-right text-xs tabular-nums text-muted-foreground">
                {m.aussen_gemessen({ gemessen: zahl(v.gemessen), minuten: zahl(v.minuten) })}
              </td>
            </Reihe>
          )}
        </For>
      </Tabelle>
    </div>
  );
};

export const VonAussen = (props: { id: string; host: string }) => {
  const antwort = createMemo(() => aussenQuelle().derInstallation(props.id));
  const gelesen = () => {
    const r = antwort();
    return r.ok ? r.daten : undefined;
  };
  const fehler = () => {
    const r = antwort();
    return r.ok ? "" : fehlerText(r);
  };
  return (
    <Karte class="overflow-hidden">
      <KartenKopf titel={m.inst_aussen()} text={m.inst_aussen_text()} />
      <Loading fallback={<p class="p-6 text-muted-foreground">{m.aussen_laden()}</p>}>
        <Show when={gelesen()} fallback={<Fehler text={fehler()} />}>
          {(d) => (
            <>
              <Pruefungen host={props.host} d={d()} />
              <Monate monate={d().verfuegbarkeit} />
            </>
          )}
        </Show>
      </Loading>
    </Karte>
  );
};
