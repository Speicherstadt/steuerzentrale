import { Icon, m } from "@steuerzentrale/ui";
import { For, Show } from "solid-js";
import { appVon, istGekuendigt, kundeVon, linuxNutzer, serverVon } from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Installation } from "../daten/typen.ts";
import { appIcon } from "../teile/app-icon.ts";
import { ZuInstallation } from "../teile/verweise.tsx";
import { HealthZeichen } from "../teile/zeichen.tsx";

/**
 * Installations as a list of cards, on a server's page (named by customer, with Linux user and
 * address) and on a customer's page (named by app, with the server)
 */
export const InstallationsListe = (props: {
  installationen: Installation[];
  zeige: "kunde" | "app";
}) => {
  const b = bestand();
  return (
    <Show
      when={props.installationen.length > 0}
      fallback={<p class="text-muted-foreground">{m.installationen_keine()}</p>}
    >
      <ul class="grid grid-cols-[minmax(0,1fr)] gap-2">
        <For each={props.installationen}>
          {(i) => (
            <li>
              <ZuInstallation
                id={i.id}
                class="flex w-full min-w-0 items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent">
                  <Icon icon={appIcon(appVon(b, i.app).icon)} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">
                    {props.zeige === "kunde"
                      ? `${kundeVon(b, i.kunde).name} · ${appVon(b, i.app).name}`
                      : appVon(b, i.app).name}{" "}
                    <span class="font-mono text-xs font-normal text-muted-foreground">
                      {i.version}
                    </span>
                  </span>
                  <span class="block truncate font-mono text-xs text-muted-foreground">
                    {props.zeige === "kunde"
                      ? `${linuxNutzer(i)} · ${i.adresse}`
                      : serverVon(b, i.server).name}
                  </span>
                </span>
                <HealthZeichen health={i.health} gekuendigt={istGekuendigt(b, i)} />
              </ZuInstallation>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
};
