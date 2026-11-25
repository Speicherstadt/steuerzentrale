import { Button, Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, Loading, refresh, Show } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { type BackupZiel, backupQuelle } from "../daten/backups.ts";
import { Angaben, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Fehler, felder } from "./anmeldung-teile.tsx";
import { MitInstallationsRecht } from "./recht.tsx";

/*
 * The settings' tab "Backup" (BAULISTE.md Z-601; mockup viewEinstellungen, "backup"): the
 * operator's S3 target (endpoint, region, bucket) and the admin access the Zentrale makes each
 * installation's own access with, set with a reason by the owner (the roles that install,
 * src/auth/rollen.ts of the Zentrale); a member sees them read-only. The admin access never comes
 * back: it shows only as set, and both fields left empty keep it.
 */

const FEHLER: Record<string, () => string> = {
  ungueltig: m.einst_backup_fehler_ungueltig,
  ziel_in_benutzung: m.einst_backup_fehler_in_benutzung,
  zugang_fehlt: m.einst_backup_fehler_zugang_fehlt,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

const fehlerText = (a: Antwort<unknown>) =>
  a.ok ? "" : (FEHLER[a.fehler] ?? m.fehler_unbekannt)();

const mono = (text: string | null) => <span class="font-mono text-xs">{text ?? "–"}</span>;

/** What stays the same for every operator: when the backups run and how long they are kept */
const ablauf = () => [
  { name: m.einst_zeitplan(), wert: m.einst_zeitplan_wert() },
  { name: m.einst_aufbewahrung(), wert: m.einst_aufbewahrung_wert() },
  { name: m.inst_pruef(), wert: m.einst_pruef_wert() },
];

const NurLesen = (props: { z: BackupZiel }) => (
  <Angaben
    zeilen={[
      { name: m.einst_backup_endpunkt(), wert: mono(props.z.endpunkt) },
      { name: m.einst_backup_region(), wert: mono(props.z.region) },
      { name: m.einst_backup_bucket(), wert: mono(props.z.bucket) },
      {
        name: m.einst_backup_zugang(),
        wert: props.z.zugangGesetzt ? m.inst_wert_gesetzt() : m.einst_nicht_gesetzt(),
      },
      ...ablauf(),
    ]}
  />
);

const leeren = (formular: HTMLFormElement, ...namen: string[]) => {
  for (const name of namen) {
    const feld = formular.elements.namedItem(name);
    if (feld instanceof HTMLInputElement) feld.value = "";
  }
};

const Formular = (props: { z: BackupZiel; gespeichert: () => void }) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const senden = async (event: SubmitEvent) => {
    const formular = event.currentTarget as HTMLFormElement;
    const w = felder(event);
    setLaeuft(true);
    const zugang = w.access && w.secret ? { accessKey: w.access, secretKey: w.secret } : {};
    const antwort = await backupQuelle().zielSetzen({
      endpunkt: w.endpunkt ?? "",
      region: w.region ?? "",
      bucket: w.bucket ?? "",
      ...zugang,
    });
    setLaeuft(false);
    setFehler(fehlerText(antwort));
    if (!antwort.ok) return;
    // the access stays in the Zentrale; the fields start empty again, as after a reload
    leeren(formular, "access", "secret");
    props.gespeichert();
  };
  return (
    <form class="grid max-w-xl gap-4" onSubmit={senden}>
      <Input
        label={m.einst_backup_endpunkt()}
        name="endpunkt"
        type="url"
        required
        autocomplete="off"
        placeholder={m.einst_backup_endpunkt_platzhalter()}
        value={props.z.endpunkt ?? ""}
        hint={m.einst_backup_endpunkt_hinweis()}
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <Input
          label={m.einst_backup_region()}
          name="region"
          required
          autocomplete="off"
          pattern="[a-z0-9-]{1,40}"
          value={props.z.region ?? "us-east-1"}
          hint={m.einst_backup_region_hinweis()}
        />
        <Input
          label={m.einst_backup_bucket()}
          name="bucket"
          required
          autocomplete="off"
          pattern="[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"
          value={props.z.bucket ?? ""}
          hint={m.einst_backup_bucket_hinweis()}
        />
      </div>
      <Input
        label={m.einst_backup_access()}
        name="access"
        autocomplete="off"
        required={!props.z.zugangGesetzt}
        hint={props.z.zugangGesetzt ? m.einst_backup_zugang_gesetzt() : m.einst_backup_zugang_neu()}
      />
      <Input
        label={m.einst_backup_secret()}
        name="secret"
        type="password"
        autocomplete="off"
        required={!props.z.zugangGesetzt}
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

export const BackupZielReiter = () => {
  const antwort = createMemo(() => backupQuelle().ziel());
  const [hinweis, setHinweis] = createSignal("");
  const gelesen = () => {
    const a = antwort();
    return a.ok ? a.daten : undefined;
  };
  return (
    <Karte>
      <KartenKopf titel={m.einst_backup()} text={m.einst_backup_text()} />
      <KartenInhalt class="grid gap-4">
        <Loading fallback={<p class="text-muted-foreground">{m.inst_laden()}</p>}>
          <Fehler text={fehlerText(antwort())} />
          <p role="status" class="text-xs text-muted-foreground">
            {hinweis()}
          </p>
          <Show when={gelesen()}>
            {(z) => (
              <MitInstallationsRecht sonst={<NurLesen z={z()} />}>
                <Formular
                  z={z()}
                  gespeichert={() => {
                    setHinweis(m.einst_backup_gespeichert());
                    refresh(antwort);
                  }}
                />
                <Angaben zeilen={ablauf()} />
              </MitInstallationsRecht>
            )}
          </Show>
        </Loading>
      </KartenInhalt>
    </Karte>
  );
};
