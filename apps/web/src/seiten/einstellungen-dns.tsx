import { Button, Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, Loading, refresh, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type DnsEinstellungen, dnsQuelle } from "../daten/dns.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The settings' tab "DNS" (BAULISTE.md Z-407; mockup viewEinstellungen, "dns"): the operator's
 * domain, the id of its zone at Cloudflare and the API token, set with a reason by owner and technik
 * (the roles that install, src/auth/rollen.ts of the Zentrale); support sees them read-only. The
 * token never comes back: it shows only as set, and an empty field keeps it.
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.einst_dns_fehler_ungueltig,
  dns_in_benutzung: m.einst_dns_fehler_in_benutzung,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

const fehlerText = (a: Antwort<unknown>) =>
  a.ok ? "" : (FEHLER[a.fehler] ?? m.fehler_unbekannt)();

const mono = (text: string) => <span class="font-mono text-xs">{text}</span>;

const schema = (domain: string | null) => (domain ? `<app>.<kürzel>.${domain}` : "–");

const NurLesen = (props: { e: DnsEinstellungen }) => (
  <Angaben
    zeilen={[
      { name: m.einst_dns_domain(), wert: mono(props.e.domain ?? "–") },
      { name: m.einst_dns_zone(), wert: mono(props.e.zoneId ?? "–") },
      {
        name: m.einst_token(),
        wert: props.e.tokenGesetzt ? m.inst_wert_gesetzt() : m.einst_nicht_gesetzt(),
      },
      { name: m.einst_schema(), wert: mono(schema(props.e.domain)) },
      { name: m.einst_zertifikate(), wert: m.einst_zertifikate_wert() },
    ]}
  />
);

const Formular = (props: { e: DnsEinstellungen; gespeichert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const formular = event.currentTarget as HTMLFormElement;
    const werte = felder(event);
    setLaeuft(true);
    const antwort = await dnsQuelle().setzen(
      {
        domain: werte.domain ?? "",
        zoneId: werte.zone ?? "",
        ...(werte.token ? { token: werte.token } : {}),
      },
      werte.grund ?? "",
    );
    setLaeuft(false);
    setFehler(fehlerText(antwort));
    if (!antwort.ok) return;
    // the token stays in the Zentrale; the field starts empty again, as after a reload
    const token = formular.elements.namedItem("token");
    if (token instanceof HTMLInputElement) token.value = "";
    props.gespeichert();
  };
  return (
    <form class="grid max-w-xl gap-4" onSubmit={senden}>
      <Input
        label={m.einst_dns_domain()}
        name="domain"
        required
        autocomplete="off"
        placeholder="apps.example.de"
        value={props.e.domain ?? ""}
        hint={m.einst_dns_domain_hinweis()}
      />
      <Input
        label={m.einst_dns_zone()}
        name="zone"
        required
        autocomplete="off"
        pattern="[0-9a-f]{32}"
        value={props.e.zoneId ?? ""}
        hint={m.einst_dns_zone_hinweis()}
      />
      <Input
        label={m.einst_token()}
        name="token"
        type="password"
        autocomplete="off"
        required={!props.e.tokenGesetzt}
        hint={props.e.tokenGesetzt ? m.einst_dns_token_gesetzt() : m.einst_dns_token_neu()}
      />
      <Input
        label={m.feld_grund()}
        name="grund"
        required
        maxlength={500}
        placeholder={m.einst_dns_grund_platzhalter()}
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

export const Dns = () => {
  const antwort = createMemo(() => dnsQuelle().lesen());
  const [hinweis, setHinweis] = createSignal("");
  const gelesen = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  return (
    <Karte>
      <KartenKopf titel={m.einst_dns()} text={m.einst_dns_text()} />
      <KartenInhalt class="grid gap-4">
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <Fehler text={fehlerText(antwort())} />
          <p role="status" class="text-xs text-muted-foreground">
            {hinweis()}
          </p>
          <Show when={gelesen()}>
            {(e) => (
              <MitInstallationsRecht sonst={<NurLesen e={e()} />}>
                <Formular
                  e={e()}
                  gespeichert={() => {
                    setHinweis(m.einst_dns_gespeichert());
                    refresh(antwort);
                  }}
                />
              </MitInstallationsRecht>
            )}
          </Show>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};
