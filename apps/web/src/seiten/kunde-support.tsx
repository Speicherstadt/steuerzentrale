import { m } from "@steuerzentrale/ui";
import { createMemo, Loading, refresh, Show } from "solid-js";
import type { AppZeile } from "../daten/apps-liste.ts";
import { appTitelVon } from "../daten/installation-ansicht.ts";
import { supportQuelle } from "../daten/support.ts";
import type { Kunde } from "../daten/typen.ts";
import { Fehler, fehlerText } from "./anmeldung-teile.tsx";
import { Liste } from "./support-liste.tsx";
import { ZugangStarten } from "./support-zugang.tsx";

/*
 * The tab "Support" of a customer (BAULISTE.md Z-802; docs/plan.md, "Server und Kunden (Oberfläche
 * 2026-11)"): the support accesses to its apps, running and ended, as the page "Support-Zugänge"
 * shows them, and "Zugang starten" for one of its apps.
 */

export const KundeSupport = (props: { k: Kunde; zeilen: AppZeile[] }) => {
  const antwort = createMemo(() => supportQuelle().liste({ kundeId: props.k.id }));
  const wahl = () =>
    props.zeilen
      .filter((z) => z.a.zustand !== "entfernt")
      .map((z) => ({ id: z.a.id, titel: appTitelVon(z.a) }));
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
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="max-w-2xl text-muted-foreground">{m.kunde_support_text()}</p>
        <Show when={wahl().length > 0}>
          <ZugangStarten installationen={wahl()} gestartet={neu} />
        </Show>
      </div>
      <Loading fallback={<p class="text-muted-foreground">{m.sup_laden()}</p>}>
        <Show when={antwort().ok} fallback={<Fehler text={fehler()} />}>
          <Liste zugaenge={zugaenge()} wahl={wahl()} neu={neu} />
        </Show>
      </Loading>
    </div>
  );
};
