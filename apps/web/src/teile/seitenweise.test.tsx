import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { createSignal, For, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Antwort } from "../anmeldung/api.ts";
import type { Seite } from "../daten/betrieb.ts";
import { Seitenweise } from "./seitenweise.tsx";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});
beforeEach(() => setLocale("de", { reload: false }));

const warten = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((fertig) => setTimeout(fertig, 0));
    flush();
  }
};

/** Five rows in pages of two, the cursor the index of the next row, as the demo hands them out */
const ZEILEN = ["a", "b", "c", "d", "e"];
const laden = vi.fn(async (weiter?: string): Promise<Antwort<Seite<string>>> => {
  const ab = Number(weiter ?? 0);
  return {
    ok: true,
    status: 200,
    daten: {
      eintraege: ZEILEN.slice(ab, ab + 2),
      weiter: ab + 2 < ZEILEN.length ? String(ab + 2) : null,
    },
  };
});

const knopf = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === "Mehr laden");

// BAULISTE.md Z-406: a list the Zentrale hands out page by page, read on with "Mehr laden"
describe("Seitenweise", () => {
  it("reads page after page with the cursor of the last, until there is none", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    dispose = render(
      () => (
        <Seitenweise
          laden={laden}
          ladenText="lädt"
          zeigen={(eintraege) => (
            <ul>
              <For each={eintraege()}>{(z) => <li>{z}</li>}</For>
            </ul>
          )}
        />
      ),
      root,
    );
    await warten();
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);
    knopf(root)?.click();
    await warten();
    knopf(root)?.click();
    await warten();
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(ZEILEN);
    expect(knopf(root)).toBeUndefined();
    expect(laden.mock.calls.map((c) => c[0])).toEqual([undefined, "2", "4"]);
  });

  it("starts over when what it reads changes, without the pages of the list before", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    // two lists of five rows each, as a server's events and then another server's
    const [liste, setListe] = createSignal("x");
    const lesen = async (weiter?: string): Promise<Antwort<Seite<string>>> => {
      const ab = Number(weiter ?? 0);
      const zeilen = ZEILEN.map((z) => `${liste()}${z}`);
      return {
        ok: true,
        status: 200,
        daten: {
          eintraege: zeilen.slice(ab, ab + 2),
          weiter: ab + 2 < zeilen.length ? String(ab + 2) : null,
        },
      };
    };
    dispose = render(
      () => (
        <Seitenweise
          laden={(weiter) => lesen(weiter)}
          ladenText="lädt"
          zeigen={(eintraege) => (
            <ul>
              <For each={eintraege()}>{(z) => <li>{z}</li>}</For>
            </ul>
          )}
        />
      ),
      root,
    );
    await warten();
    knopf(root)?.click();
    await warten();
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "xa",
      "xb",
      "xc",
      "xd",
    ]);
    setListe("y");
    await warten();
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["ya", "yb"]);
  });
});
