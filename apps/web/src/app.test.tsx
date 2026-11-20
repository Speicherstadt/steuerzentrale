import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./app.tsx";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});

const mount = (locale: "de" | "en") => {
  setLocale(locale, { reload: false });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <App />, root);
  flush();
  return root;
};

describe("start page", () => {
  it("shows the name in German", () => {
    expect(mount("de").querySelector("h1")?.textContent).toBe("Steuerzentrale");
  });

  it("shows the tagline in English", () => {
    expect(mount("en").querySelector("p")?.textContent).toContain("servers");
  });
});
