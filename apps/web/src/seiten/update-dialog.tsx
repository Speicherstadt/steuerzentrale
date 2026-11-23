import { Button, Dialog, Icon, Input, m } from "@steuerzentrale/ui";
import { TriangleAlert } from "@steuerzentrale/ui/icons";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { Fehlschlag } from "../anmeldung/api.ts";
import { type Angebot, appsQuelle, type InstallationsAngebot } from "../daten/apps.ts";
import { Fehler, fehlerText, felder } from "./anmeldung-teile.tsx";

/*
 * An update by hand (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)"): for owner
 * and technik, one dialog for the installation chosen on the page "Updates" that asks for the
 * version among those it is offered (the newest first) and a reason, and says plainly that the
 * current state is backed up first and a version that does not turn healthy is rolled back. In a
 * freeze window of the app only the owner may; the Zentrale refuses everyone else, the dialog says
 * why.
 */

const FEHLER: Record<string, () => string> = {
  sperrzeit: m.upd_fehler_sperrzeit,
  server_belegt: m.upd_fehler_server_belegt,
  nicht_angeboten: m.upd_fehler_nicht_angeboten,
  kein_manifest: m.upd_fehler_kein_manifest,
  werte_fehlen: m.upd_fehler_werte_fehlen,
  nicht_eingerichtet: m.aktion_fehler_nicht_eingerichtet,
  laeuft_nicht: m.aktion_fehler_laeuft_nicht,
  auftrag_offen: m.inst_fehler_auftrag_offen,
  nicht_ausfuehrbar: m.aktion_fehler_nicht_ausfuehrbar,
};

const fehlerVon = (f: Fehlschlag) => (FEHLER[f.fehler] ?? (() => fehlerText(f)))();

/** A version as the choice names it: urgent or a pre-release said in words */
const versionText = (v: Angebot) => {
  if (v.dringend) return m.upd_version_dringend({ version: v.version });
  return v.vorabversion ? m.upd_version_vorab({ version: v.version }) : v.version;
};

/** The plain warning: nothing changes before the current state is safe, and red goes back */
const Hinweis = () => (
  <div role="note" class="flex items-start gap-3 rounded-lg border border-warn/50 px-4 py-3">
    <Icon icon={TriangleAlert} size={16} class="mt-0.5 shrink-0 text-warn" />
    <div class="grid min-w-0 gap-1">
      <p class="font-medium text-warn">{m.upd_hinweis_titel()}</p>
      <p class="text-muted-foreground">{m.upd_hinweis()}</p>
    </div>
  </div>
);

const feld =
  "h-8 w-full rounded-lg border bg-background px-2.5 font-mono focus-visible:outline-2 focus-visible:outline-foreground";

const VersionsWahl = (props: { angeboten: Angebot[] }) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {m.upd_feld_version()}
      </label>
      <select id={id} name="version" class={feld} required>
        <For each={props.angeboten}>
          {(v) => <option value={v.version}>{versionText(v)}</option>}
        </For>
      </select>
    </div>
  );
};

/** The dialog for the installation chosen, if one is; `angefordert` once the jobs are made */
export const UpdateDialog = (props: {
  i: InstallationsAngebot | undefined;
  onClose: () => void;
  angefordert: () => void;
}) => {
  const [fehler, setFehler] = createSignal("");
  const [laeuft, setLaeuft] = createSignal(false);
  const schliessen = () => {
    setFehler("");
    props.onClose();
  };
  const senden = async (event: SubmitEvent) => {
    const werte = felder(event);
    const i = props.i;
    if (!i) return;
    setLaeuft(true);
    const antwort = await appsQuelle().update(
      i.installationId,
      werte.version ?? "",
      werte.grund ?? "",
    );
    setLaeuft(false);
    if (!antwort.ok) return setFehler(fehlerVon(antwort));
    setFehler("");
    props.angefordert();
  };
  return (
    <Dialog
      open={props.i !== undefined}
      onClose={schliessen}
      title={m.upd_titel()}
      description={m.upd_dialog_text({
        name: props.i?.installationId ?? "",
        version: props.i?.version ?? "",
      })}
    >
      <Show when={props.i}>
        {(i) => (
          <form class="grid gap-4" onSubmit={senden}>
            <Hinweis />
            <VersionsWahl angeboten={i().angeboten} />
            <Input
              label={m.feld_grund()}
              name="grund"
              required
              maxlength={500}
              placeholder={m.upd_grund_platzhalter()}
              hint={m.feld_grund_hinweis()}
            />
            <p class="text-xs text-muted-foreground">{m.upd_sperrzeit_regel()}</p>
            <Fehler text={fehler()} />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={schliessen}>{m.knopf_abbrechen()}</Button>
              <Button type="submit" variant="danger" disabled={laeuft()}>
                {m.upd_ausfuehren()}
              </Button>
            </div>
          </form>
        )}
      </Show>
    </Dialog>
  );
};
