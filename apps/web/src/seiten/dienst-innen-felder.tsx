import { Input, m } from "@steuerzentrale/ui";
import { createMemo, createSignal, createUniqueId, For, Loading, Show } from "solid-js";
import { type DienstInnen, type InnenAngaben, innenAngaben, unitsAus } from "../daten/dienste.ts";
import { serverQuelle } from "../daten/server.ts";

/*
 * The inside of an observed service in its dialog (BAULISTE.md Z-1103): on a server that is only
 * observed (Z-1102), the Linux user (empty for units of the system), the units and, if wanted, the
 * port and path of a check on 127.0.0.1. Without such a server the dialog says why there is nothing
 * to choose. The patterns are those the Zentrale and the agent check (packages/protokoll). While
 * the servers are not listed (loading, an error, none observed) there is no choice, and a service
 * keeps the inside it had: only the choice "from outside only" takes it away.
 */

const feldKlasse =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] disabled:opacity-50";

/** The hidden field that says the server could be chosen */
const WAHL = "innenWahl";

/** The inside from the form's values, null without a server; what it was where none could be chosen */
export const innenAusFeldern = (
  w: Record<string, string | undefined>,
  vorher: DienstInnen | null,
): InnenAngaben | null => {
  if (!w[WAHL]) return vorher && innenAngaben(vorher);
  if (!w.innenServer) return null;
  const port = w.innenPort ? Number(w.innenPort) : null;
  return {
    serverId: w.innenServer,
    nutzer: w.innenNutzer ? w.innenNutzer : null,
    units: unitsAus(w.innenUnits ?? ""),
    port,
    pfad: port !== null && w.innenPfad ? w.innenPfad : null,
  };
};

const Felder = (props: { innen: DienstInnen | null }) => (
  <div class="grid gap-4">
    <Input
      label={m.dienst_feld_nutzer()}
      name="innenNutzer"
      maxlength={32}
      autocomplete="off"
      pattern="[a-z_][a-z0-9_\-]{0,31}"
      value={props.innen?.nutzer ?? ""}
      hint={m.dienst_nutzer_hinweis()}
    />
    <Input
      label={m.dienst_feld_units()}
      name="innenUnits"
      required
      maxlength={2000}
      autocomplete="off"
      placeholder={m.dienst_units_platzhalter()}
      value={props.innen?.units.join(" ") ?? ""}
      hint={m.dienst_units_hinweis()}
    />
    <div class="grid gap-4 sm:grid-cols-2">
      <Input
        label={m.dienst_feld_port()}
        name="innenPort"
        type="number"
        min={1}
        max={65535}
        value={
          props.innen && props.innen.health.art !== "keine" ? String(props.innen.health.port) : ""
        }
        hint={m.dienst_port_hinweis()}
      />
      <Input
        label={m.dienst_feld_innen_pfad()}
        name="innenPfad"
        maxlength={200}
        autocomplete="off"
        pattern="/[^?#\s]*"
        value={props.innen?.health.art === "http" ? props.innen.health.pfad : ""}
        hint={m.dienst_innen_pfad_hinweis()}
      />
    </div>
  </div>
);

/** The server to read on, and the fields once one is chosen */
export const InnenFelder = (props: { innen: DienstInnen | null }) => {
  const antwort = createMemo(() => serverQuelle().liste());
  const beobachtet = () => {
    const a = antwort();
    return a.ok ? a.daten.filter((s) => s.fakten?.nurBeobachten === true) : [];
  };
  const [gewaehlt, setGewaehlt] = createSignal(() => props.innen?.serverId ?? "");
  const id = createUniqueId();
  return (
    <Loading fallback={null}>
      <fieldset class="grid gap-4 rounded-lg border border-border p-3">
        <legend class="px-1 text-xs font-medium">{m.dienst_innen_titel()}</legend>
        <Show
          when={beobachtet().length > 0}
          fallback={<p class="text-xs text-muted-foreground">{m.dienst_innen_kein_server()}</p>}
        >
          <input type="hidden" name={WAHL} value="1" />
          <div class="grid gap-1.5">
            <label for={id} class="text-xs font-medium">
              {m.dienst_feld_server()}
            </label>
            <select
              id={id}
              name="innenServer"
              class={feldKlasse}
              onChange={(e) => setGewaehlt(e.currentTarget.value)}
            >
              <option value="" selected={gewaehlt() === ""}>
                {m.dienst_nur_aussen()}
              </option>
              <For each={beobachtet()}>
                {(s) => (
                  <option value={s.serverId} selected={s.serverId === gewaehlt()}>
                    {s.name}
                  </option>
                )}
              </For>
            </select>
          </div>
          <Show when={gewaehlt() !== ""}>
            <Felder innen={props.innen} />
          </Show>
        </Show>
      </fieldset>
    </Loading>
  );
};
