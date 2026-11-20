import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { expect, it } from "vitest";
import { setLocale } from "../paraglide/runtime.js";
import { Dialog } from "./dialog.tsx";
import { Tabs } from "./tabs.tsx";

it("wraps Tab from the last focusable element when the dialog holds tabs", () => {
  setLocale("de", { reload: false });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Dialog open onClose={() => {}} title="Eintrag">
        <Tabs
          label="Eintrag"
          tabs={[
            { id: "fields", label: "Felder", content: () => <p>Benutzername</p> },
            { id: "access", label: "Zugriff", content: () => <p>Jonas</p> },
          ]}
        />
      </Dialog>
    ),
    root,
  );
  flush();
  // The visible panel is the last element Tab can reach; the hidden panel and the
  // inactive tab (tabindex -1) are not
  const panel = root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
  panel?.focus();
  expect(document.activeElement).toBe(panel);
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  panel?.dispatchEvent(event);
  flush();
  expect(event.defaultPrevented).toBe(true);
  dispose();
});
