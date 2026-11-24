import { m } from "@steuerzentrale/ui";
import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, Loading, refresh, Show } from "solid-js";
import { titelVon } from "../daten/installation-ansicht.ts";
import { uebersichtLaden } from "../daten/installationen-laden.ts";
import { supportQuelle } from "../daten/support.ts";
import { Fehler, fehlerText } from "../seiten/anmeldung-teile.tsx";
import { Liste } from "../seiten/support-liste.tsx";
import { type Wahl, ZugangStarten } from "../seiten/support-zugang.tsx";
import { Seitenkopf } from "../teile/karte.tsx";
import { KundenReiter } from "../teile/reiter-links.tsx";

/**
 * Time-limited access to an installation, with a reason, logged (BAULISTE.md Z-802; mockup,
 * "Support-Zugänge"): the running ones with their time left, the ended ones with what happened, and
 * "Zugang starten". Its holder ends an access, owner and technik also another's.
 */

const Support = () => {
  const antwort = createMemo(() => supportQuelle().liste());
  const installationen = createMemo(() => uebersichtLaden());
  const wahl = (): Wahl[] => {
    const a = installationen();
    return a.ok
      ? a.daten.installationen
          .filter((i) => i.zustand !== "entfernt")
          .map((i) => ({ id: i.id, titel: titelVon(i) }))
      : [];
  };
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
      <Seitenkopf
        titel={m.nav_support()}
        text={m.sup_text()}
        aktion={
          <Loading fallback={null}>
            <ZugangStarten installationen={wahl()} gestartet={neu} />
          </Loading>
        }
      />
      <KundenReiter />
      <Loading fallback={<p class="text-muted-foreground">{m.sup_laden()}</p>}>
        <Show when={antwort().ok} fallback={<Fehler text={fehler()} />}>
          <Liste zugaenge={zugaenge()} wahl={wahl()} neu={neu} />
        </Show>
      </Loading>
    </div>
  );
};

export const Route = createFileRoute("/support")({ component: Support });
