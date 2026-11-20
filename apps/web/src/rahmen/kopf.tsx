import { Icon, IconButton, m } from "@steuerzentrale/ui";
import { ChevronRight, LogOut, PanelLeft, ShieldCheck, SunMoon, X } from "@steuerzentrale/ui/icons";
import { Link, useLocation, useNavigate } from "@tanstack/solid-router";
import { createEffect, createSignal, For, Show } from "solid-js";
import { abmelden } from "../anmeldung/sitzung.ts";
import { bestand } from "../daten/quelle.ts";
import { pfadStufen } from "./navigation.ts";
import { Seitenleiste } from "./seitenleiste.tsx";
import { aktuellesThema, geraetIstDunkel, umgeschaltet, waehleThema } from "./theme.ts";

/** The header: the drawer on a phone, the path, the VPN note and light or dark (design/mockup/) */

const Pfad = () => {
  const ort = useLocation();
  const stufen = () => pfadStufen(bestand(), ort().pathname);
  return (
    <nav aria-label={m.kopf_pfad()} class="min-w-0">
      <ol class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <For each={stufen()}>
          {(stufe) => (
            <li class="flex min-w-0 items-center gap-1.5">
              <Show
                when={stufe.pfad}
                fallback={
                  <span aria-current="page" class="truncate font-medium text-foreground">
                    {stufe.name}
                  </span>
                }
              >
                {(pfad) => (
                  <>
                    <Link
                      to={pfad()}
                      activeOptions={{ exact: true }}
                      class="whitespace-nowrap hover:text-foreground"
                    >
                      {stufe.name}
                    </Link>
                    <Icon icon={ChevronRight} size={14} />
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
};

/**
 * The navigation on a phone: the sidebar in a modal <dialog>, so the browser traps the focus and
 * Esc closes it; a new page closes it too
 */
const Schublade = () => {
  const ort = useLocation();
  // Open on the page it was opened on: following a link changes the page and so closes it
  const [offenAuf, setOffenAuf] = createSignal<string | null>(null);
  const offen = () => offenAuf() === ort().pathname;
  const setOffen = (auf: boolean) => setOffenAuf(auf ? ort().pathname : null);
  let dialog: HTMLDialogElement | undefined;
  createEffect(
    () => offen(),
    (auf) => {
      if (auf && !dialog?.open) dialog?.showModal();
      if (!auf && dialog?.open) dialog.close();
    },
  );
  return (
    <>
      <IconButton
        label={m.kopf_navigation()}
        class="-ml-1 md:hidden"
        aria-haspopup="dialog"
        onClick={() => setOffen(true)}
      >
        <Icon icon={PanelLeft} />
      </IconButton>
      <dialog
        ref={(el) => {
          dialog = el;
        }}
        aria-label={m.kopf_navigation()}
        onClose={() => setOffen(false)}
        class="fixed inset-y-0 left-0 m-0 h-svh max-h-none w-72 max-w-[85vw] border-r bg-sidebar p-0 text-foreground backdrop:bg-black/60"
      >
        <Show when={offen()}>
          <div class="flex h-full flex-col">
            <div class="flex justify-end p-2 pb-0">
              <IconButton label={m.kopf_schliessen()} onClick={() => setOffen(false)}>
                <Icon icon={X} />
              </IconButton>
            </div>
            <div class="min-h-0 flex-1">
              <Seitenleiste />
            </div>
          </div>
        </Show>
      </dialog>
    </>
  );
};

/** Ends the session and goes to the sign-in */
const Abmelden = () => {
  const navigate = useNavigate();
  return (
    <IconButton
      label={m.abmelden()}
      onClick={async () => {
        await abmelden();
        await navigate({ to: "/anmelden" });
      }}
    >
      <Icon icon={LogOut} />
    </IconButton>
  );
};

export const Kopf = () => (
  <header class="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
    <Schublade />
    <Pfad />
    <div class="ml-auto flex items-center gap-2">
      <span class="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <Icon icon={ShieldCheck} size={14} />
        {m.kopf_vpn()}
      </span>
      <IconButton
        label={m.kopf_thema()}
        onClick={() => waehleThema(umgeschaltet(aktuellesThema(), geraetIstDunkel()))}
      >
        <Icon icon={SunMoon} />
      </IconButton>
      <Abmelden />
    </div>
  </header>
);
