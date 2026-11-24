import { Icon, m } from "@steuerzentrale/ui";
import { Radar } from "@steuerzentrale/ui/icons";
import { Link, useLocation } from "@tanstack/solid-router";
import { createMemo, For, Loading, Show } from "solid-js";
import { betriebQuelle } from "../daten/betrieb.ts";
import { betriebsartLesen, nurFuerMich } from "../daten/betriebsart.ts";
import { type Ich, ichLesen } from "../daten/ich.ts";
import { bestand } from "../daten/quelle.ts";
import { brauchtAufmerksamkeit } from "../daten/zu-tun.ts";
import { zaehler } from "../daten/zustand.ts";
import { GRUPPEN, heimat, sichtbareGruppen, type Zaehler } from "./navigation.ts";
import { rolleName } from "./texte.ts";
import { VERSION } from "./version.ts";

/**
 * The sidebar (DESIGN.md, "Bausteine"): eight areas in the groups Betrieb and Verwaltung, a
 * counter only where there is something to do; at the foot the own account, named by the Zentrale
 * (GET /api/v1/ich, Z-406), and the version of this build. Without the operator switch of stage 2 (BAULISTE.md, Z-803).
 */

const Marke = (props: { ich: Ich | null }) => (
  <div class="flex h-12 items-center gap-2 p-2">
    <span class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <Icon icon={Radar} />
    </span>
    <span class="grid min-w-0 flex-1 leading-tight">
      <span class="truncate font-semibold">{m.app_name()}</span>
      <span class="truncate text-xs text-muted-foreground">
        <Loading fallback="">{m.nav_betreiber({ name: props.ich?.betreiber.name ?? "" })}</Loading>
      </span>
    </span>
  </div>
);

const Zahl = (props: { n: number }) => (
  <Show when={props.n}>
    {(n) => <span class="ml-auto text-xs font-medium tabular-nums">{n()}</span>}
  </Show>
);

/**
 * The counters: what needs attention as the overview counts it (GET /api/v1/uebersicht), and the
 * apps with a newer version
 */
const zahlen = (): ((art: Zaehler) => number) => {
  const eintraege = createMemo(() => betriebQuelle().uebersicht());
  return (art) => {
    if (art === "updates") return zaehler(bestand()).updates;
    const a = eintraege();
    return a.ok ? brauchtAufmerksamkeit(a.daten) : 0;
  };
};

const Bereiche = () => {
  const zahl = zahlen();
  const ort = useLocation();
  // "Nur für mich" hides the customers, with them support accesses and services (Z-805)
  const art = createMemo(() => betriebsartLesen());
  return (
    <nav aria-label={m.nav_bereiche()} class="flex flex-col">
      <Loading fallback="">
        <For each={sichtbareGruppen(GRUPPEN, nurFuerMich(art()))}>
          {(gruppe) => (
            <div class="flex flex-col p-2 pt-1">
              <h2 class="flex h-7 items-center px-2 text-xs font-medium text-muted-foreground">
                {gruppe.name()}
              </h2>
              <ul class="flex flex-col gap-0.5">
                <For each={gruppe.bereiche}>
                  {(bereich) => (
                    <li>
                      <Link
                        to={bereich.pfad}
                        activeOptions={{ exact: bereich.pfad === "/" }}
                        // a page below an area (Support-Zugänge under Kunden) marks its area too
                        aria-current={heimat(ort().pathname) === bereich.pfad ? "page" : undefined}
                        class="flex h-8 items-center gap-2 overflow-hidden rounded-md px-2 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                      >
                        <Icon icon={bereich.icon} />
                        <span class="truncate">{bereich.name()}</span>
                        <Show when={bereich.zaehler}>
                          {(z) => (
                            <Loading fallback={null}>
                              <Zahl n={zahl(z())} />
                            </Loading>
                          )}
                        </Show>
                      </Link>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </Loading>
    </nav>
  );
};

const initialen = (name: string) =>
  name
    .split(" ")
    .map((teil) => teil[0])
    .join("")
    .slice(0, 2);

const Konto = (props: { ich: Ich | null }) => (
  <Link
    to="/einstellungen"
    search={{ tab: "konten" }}
    class="flex h-12 items-center gap-2 rounded-md p-2 hover:bg-accent"
  >
    <span
      aria-hidden="true"
      class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-medium"
    >
      <Loading fallback="">{initialen(props.ich?.name ?? "")}</Loading>
    </span>
    <Loading fallback={<span class="flex-1" />}>
      <Show when={props.ich}>
        {(k) => (
          <span class="grid min-w-0 flex-1 leading-tight">
            <span class="truncate font-medium">{k().name}</span>
            <span class="truncate text-xs text-muted-foreground">
              {m.konto_rolle_faktor({
                rolle: rolleName(k().rolle),
                faktor: k().faktor === "passkey" ? m.faktor_passkey() : m.faktor_totp(),
              })}
            </span>
          </span>
        )}
      </Show>
    </Loading>
  </Link>
);

/** The sidebar's content, on the desktop beside the page and on a phone in the drawer */
export const Seitenleiste = () => {
  // the signed-in account; null when the Zentrale does not answer
  const ich = createMemo(() => ichLesen().then((a): Ich | null => (a.ok ? a.daten : null)));
  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="p-2">
        <Marke ich={ich()} />
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
        <Bereiche />
      </div>
      <div class="p-2">
        <Konto ich={ich()} />
        <p class="px-2 pt-1 text-xs text-muted-foreground tabular-nums">
          {m.nav_version({ version: VERSION })}
        </p>
      </div>
    </div>
  );
};
