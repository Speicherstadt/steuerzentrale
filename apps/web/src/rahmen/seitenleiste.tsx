import { Icon, m } from "@steuerzentrale/ui";
import { CalendarClock, Radar } from "@steuerzentrale/ui/icons";
import { Link } from "@tanstack/solid-router";
import { createMemo, For, Loading, Show } from "solid-js";
import { alleSperrzeiten, sperrzeitAktiv } from "../daten/ableitungen.ts";
import { type Ich, ichLesen } from "../daten/ich.ts";
import { bestand } from "../daten/quelle.ts";
import { zaehler } from "../daten/zustand.ts";
import { GRUPPEN } from "./navigation.ts";
import { rolleName } from "./texte.ts";

/**
 * The sidebar (DESIGN.md, "Bausteine"): the areas in groups Betrieb, Kunden, System, counters only
 * where there is something to do; at the foot the freeze windows and the own account, named by the
 * Zentrale (GET /api/v1/ich, Z-406). Without the operator switch of stage 2 (BAULISTE.md, Z-803).
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

const Bereiche = () => {
  const zahlen = zaehler(bestand());
  return (
    <nav aria-label={m.nav_bereiche()} class="flex flex-col">
      <For each={GRUPPEN}>
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
                      class="flex h-8 items-center gap-2 overflow-hidden rounded-md px-2 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                    >
                      <Icon icon={bereich.icon} />
                      <span class="truncate">{bereich.name()}</span>
                      <Show when={bereich.zaehler && zahlen[bereich.zaehler]}>
                        {(n) => <span class="ml-auto text-xs font-medium tabular-nums">{n()}</span>}
                      </Show>
                    </Link>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
};

/** The freeze windows of every app, from the manifests: when no update and no reboot runs */
const Sperrzeiten = () => {
  const b = bestand();
  const alle = alleSperrzeiten(b);
  const aktiv = alle.filter((z) => sperrzeitAktiv(z, b.jetzt));
  return (
    <section class="rounded-xl border bg-background p-4">
      <h2 class="flex items-center gap-2 font-semibold">
        <Icon icon={CalendarClock} class={aktiv.length ? "text-warn" : "text-muted-foreground"} />
        {m.sperrzeiten_titel()}
      </h2>
      <p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {aktiv.length
          ? m.sperrzeiten_aktiv({ apps: aktiv.map((z) => z.appName).join(", ") })
          : m.sperrzeiten_keine_aktiv()}
      </p>
      <ul class="mt-1 grid gap-0.5 text-xs leading-relaxed text-muted-foreground">
        <For each={alle}>
          {(z) => (
            <li>
              <span class="font-medium text-foreground">{z.appName}:</span>{" "}
              {m.sperrzeiten_monatlich({ von: z.von, bis: z.bis })}
            </li>
          )}
        </For>
      </ul>
      <p class="mt-1 text-xs text-muted-foreground">{m.sperrzeiten_quelle()}</p>
    </section>
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
        <div class="mt-auto p-2">
          <Sperrzeiten />
        </div>
      </div>
      <div class="p-2">
        <Konto ich={ich()} />
      </div>
    </div>
  );
};
