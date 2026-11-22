import { render } from "@solidjs/web";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/solid-router";
import { flush } from "solid-js";
import { routeTree } from "../routeTree.gen.ts";

/*
 * For the component tests of the pages: the app rendered at a path with the router, waiting until
 * its async data settled, and the controls of an open dialog found by their visible label.
 */

let dispose = () => {};

/** Takes the rendered app away; for afterEach */
export const aufraeumen = () => {
  dispose();
  document.body.innerHTML = "";
};

export const warten = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((fertig) => setTimeout(fertig, 0));
    flush();
  }
};

export const oeffne = async (pfad: string) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pfad] }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <RouterProvider router={router} />, root);
  await router.load();
  await warten();
  return { root, router };
};

export const knopf = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

export const dialog = () => {
  const d = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (!d) throw new Error("no open dialog");
  return d;
};

/** The field with this visible label, in the open dialog unless `in` names another place */
export const feld = <T extends HTMLElement>(label: string, ort: ParentNode = dialog()): T => {
  const marke = [...ort.querySelectorAll("label")].find((l) => l.textContent === label);
  const f = ort.querySelector<T>(`#${CSS.escape(marke?.htmlFor ?? "")}`);
  if (!f) throw new Error(`no field "${label}"`);
  return f;
};

export const eintragen = (label: string, wert: string, ort?: ParentNode) => {
  const f = feld<HTMLInputElement>(label, ort);
  f.value = wert;
  f.dispatchEvent(new Event("input", { bubbles: true }));
};
