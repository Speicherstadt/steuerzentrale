import { createSignal } from "solid-js";

/*
 * Light, dark or like the device; kept per browser, a convenience and not shared state (as in
 * Speicherstadt/soll, apps/web/src/rahmen/theme.ts). packages/ui/src/styles.css reads data-theme.
 */

export const THEMEN = ["system", "hell", "dunkel"] as const;
export type Thema = (typeof THEMEN)[number];

const SCHLUESSEL = "steuerzentrale-thema";

export type Ablage = Pick<Storage, "getItem" | "setItem">;

/** The stored theme, or "system" when none is stored or storage is blocked */
export const liesThema = (ablage: Ablage | undefined): Thema => {
  try {
    const wert = ablage?.getItem(SCHLUESSEL);
    return THEMEN.find((thema) => thema === wert) ?? "system";
  } catch {
    return "system";
  }
};

export const speichereThema = (ablage: Ablage | undefined, thema: Thema): void => {
  try {
    ablage?.setItem(SCHLUESSEL, thema);
  } catch {
    // private windows may refuse storage; the theme then holds until the page reloads
  }
};

/** Sets data-theme on <html>; "system" removes it and the device decides */
export const wendeThemaAn = (root: HTMLElement, thema: Thema): void => {
  if (thema === "system") delete root.dataset.theme;
  else root.dataset.theme = thema === "dunkel" ? "dark" : "light";
};

/** The header's button: the opposite of what is shown now, whether chosen or from the device */
export const umgeschaltet = (thema: Thema, geraetDunkel: boolean): Thema => {
  const dunkel = thema === "dunkel" || (thema === "system" && geraetDunkel);
  return dunkel ? "hell" : "dunkel";
};

const ablage = (): Storage | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};

// One theme for the header's button and the settings; module scope is fine in this client-only SPA
const [thema, setzeThema] = createSignal<Thema>(liesThema(ablage()));

export const aktuellesThema = thema;

/** Chosen in an event handler: shown at once and kept for the next visit */
export const waehleThema = (neu: Thema) => {
  setzeThema(neu);
  speichereThema(ablage(), neu);
  wendeThemaAn(document.documentElement, neu);
};

export const geraetIstDunkel = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
