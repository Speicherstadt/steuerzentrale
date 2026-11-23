import { Icon, m } from "@steuerzentrale/ui";
import { For, Show } from "solid-js";
import {
  anzeige,
  type InstallationAnsicht,
  linuxNutzerVon,
  titelVon,
} from "../daten/installation-ansicht.ts";
import { appIcon } from "../teile/app-icon.ts";
import { ZuInstallation } from "../teile/verweise.tsx";
import { InstallationsZeichen } from "../teile/zeichen.tsx";

/**
 * The Zentrale's installations as a list of cards (BAULISTE.md Z-406), on a server's page (named by
 * customer, with Linux user and address) and on a customer's page (named by app, with the server)
 */
export const InstallationsListe = (props: {
  installationen: InstallationAnsicht[];
  zeige: "kunde" | "app";
}) => (
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
                <Icon icon={appIcon(i.appIcon)} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">
                  {props.zeige === "kunde" ? titelVon(i) : i.appName}{" "}
                  <span class="font-mono text-xs font-normal text-muted-foreground">
                    {i.version}
                  </span>
                </span>
                <span class="block truncate font-mono text-xs text-muted-foreground">
                  {props.zeige === "kunde" ? `${linuxNutzerVon(i)} · ${i.host}` : i.serverName}
                </span>
              </span>
              <InstallationsZeichen anzeige={anzeige(i)} gekuendigt={i.vertragsende !== null} />
            </ZuInstallation>
          </li>
        )}
      </For>
    </ul>
  </Show>
);
