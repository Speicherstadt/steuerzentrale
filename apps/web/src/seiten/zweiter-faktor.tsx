import { Button, Input, m } from "@steuerzentrale/ui";
import { createSignal, For, Show } from "solid-js";
import { api } from "../anmeldung/api.ts";
import { qrPfad, totpGeheimnis } from "../anmeldung/qr.ts";
import { passkeyRegistrieren } from "../anmeldung/webauthn.ts";
import { Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";

type Verbindung = { totpURI: string; backupCodes: string[] };

const QrCode = (props: { uri: string }) => {
  const qr = () => qrPfad(props.uri);
  return (
    <svg
      role="img"
      aria-label={m.einr_totp_qr()}
      viewBox={`0 0 ${qr().groesse} ${qr().groesse}`}
      class="size-48 rounded-md bg-white text-black"
      shape-rendering="crispEdges"
    >
      <path d={qr().d} fill="currentColor" />
    </svg>
  );
};

/** The QR code, the key to type in, the backup codes and the field for the first code */
const TotpBestaetigen = (props: { verbindung: Verbindung; fertig: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const bestaetigen = async (event: SubmitEvent) => {
    const { code = "" } = felder(event);
    const antwort = await api("/api/auth/two-factor/verify-totp", { body: { code } });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    props.fertig();
  };
  return (
    <div class="grid gap-4">
      <QrCode uri={props.verbindung.totpURI} />
      <div class="grid gap-1">
        <p class="text-xs font-medium">{m.einr_totp_geheimnis()}</p>
        <code data-testid="totp-geheimnis" class="font-mono break-all">
          {totpGeheimnis(props.verbindung.totpURI)}
        </code>
      </div>
      <div class="grid gap-1">
        <p class="text-muted-foreground">{m.einr_totp_ersatz()}</p>
        <ul class="grid grid-cols-2 gap-1 font-mono">
          <For each={props.verbindung.backupCodes}>{(code) => <li>{code}</li>}</For>
        </ul>
      </div>
      <form class="grid gap-4" onSubmit={bestaetigen}>
        <Input
          label={m.anm_code()}
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          required
        />
        <Fehler text={fehler()} />
        <Button type="submit" variant="primary">
          {m.einr_totp_bestaetigen()}
        </Button>
      </form>
    </div>
  );
};

/** TOTP for an account with a password: confirm the password, then scan and confirm a code */
export const TotpKarte = (props: { verbunden: boolean; fertig: () => void }) => {
  const [verbindung, setVerbindung] = createSignal<Verbindung>();
  const [fehler, setFehler] = createSignal("");
  const starten = async (event: SubmitEvent) => {
    const { passwort = "" } = felder(event);
    const antwort = await api<Verbindung>("/api/auth/two-factor/enable", {
      body: { password: passwort },
    });
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    setVerbindung(antwort.daten);
  };
  return (
    <Karte>
      <KartenKopf titel={m.einr_totp_titel()} text={m.einr_totp_text()} />
      <KartenInhalt>
        <Show when={!props.verbunden} fallback={<p class="font-medium">{m.einr_totp_fertig()}</p>}>
          <Show
            when={verbindung()}
            fallback={
              <form class="grid gap-4" onSubmit={starten}>
                <Input
                  label={m.einr_totp_passwort()}
                  name="passwort"
                  type="password"
                  autocomplete="current-password"
                  required
                />
                <Fehler text={fehler()} />
                <Button type="submit">{m.einr_totp_start()}</Button>
              </form>
            }
          >
            {(offen) => <TotpBestaetigen verbindung={offen()} fertig={props.fertig} />}
          </Show>
        </Show>
      </KartenInhalt>
    </Karte>
  );
};

/** Adds a passkey of this device or a security key */
export const PasskeyKarte = (props: {
  anzahl: number;
  mitPasswort: boolean;
  fertig: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const anlegen = async () => {
    const antwort = await passkeyRegistrieren(navigator.platform || m.einr_passkey_titel());
    if (!antwort.ok) return setFehler(fehlerText(antwort));
    setFehler("");
    props.fertig();
  };
  return (
    <Karte>
      <KartenKopf
        titel={m.einr_passkey_titel()}
        text={m.einr_passkey_text()}
        aktion={<Button onClick={anlegen}>{m.einr_passkey_knopf()}</Button>}
      />
      <KartenInhalt class="grid gap-2">
        <p>{m.einr_passkeys({ n: String(props.anzahl) })}</p>
        <Show when={props.mitPasswort}>
          <p class="text-muted-foreground">{m.einr_passkey_mit_passwort()}</p>
        </Show>
        <Fehler text={fehler()} />
      </KartenInhalt>
    </Karte>
  );
};
