import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Balken } from "./balken.tsx";
import { HealthZeichen, ServerZeichen } from "./zeichen.tsx";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});
beforeEach(() => setLocale("de", { reload: false }));

const mount = (ui: () => JSX.Element) => {
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(ui, root);
  flush();
  return root;
};

describe("state badges", () => {
  it("say the state in words beside the coloured icon (DESIGN.md)", () => {
    const root = mount(() => <HealthZeichen health="rot" gekuendigt={false} />);
    expect(root.textContent).toBe("Rot");
    expect(root.querySelector("svg")?.getAttribute("class")).toContain("text-destructive");
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("show a cancelled installation as cancelled, whatever its health", () => {
    expect(mount(() => <HealthZeichen health="gruen" gekuendigt />).textContent).toBe("Gekündigt");
  });

  it("name a server's state in English too", () => {
    setLocale("en", { reload: false });
    expect(mount(() => <ServerZeichen zustand="agent" />).textContent).toBe("Agent silent");
  });
});

describe("bars", () => {
  it("are progress bars with a name and their value", () => {
    const bar = mount(() => <Balken name="Platte" wert={91} warn />).querySelector(
      '[role="progressbar"]',
    );
    expect(bar?.getAttribute("aria-label")).toBe("Platte");
    expect(bar?.getAttribute("aria-valuenow")).toBe("91");
    expect(bar?.querySelector("div")?.getAttribute("class")).toContain("bg-warn");
  });
});
