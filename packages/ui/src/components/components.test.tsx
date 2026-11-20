import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../paraglide/runtime.js";
import { Badge } from "./badge.tsx";
import { Button, IconButton } from "./button.tsx";
import { Combobox, matching } from "./combobox.tsx";
import { Input, SearchInput } from "./input.tsx";
import { List } from "./list.tsx";
import { Tabs } from "./tabs.tsx";
import { createToasts, TOAST_MS, Toaster } from "./toast.tsx";
import { Tooltip } from "./tooltip.tsx";

// happy-dom has no Popover API; Playwright checks the real one (e2e/components.spec.ts)
HTMLElement.prototype.showPopover ??= function (this: HTMLElement) {
  this.dataset.open = "";
};
HTMLElement.prototype.hidePopover ??= function (this: HTMLElement) {
  delete this.dataset.open;
};

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});
const mount = (view: () => unknown) => {
  setLocale("de", { reload: false });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(view as () => never, root);
  flush();
  return root;
};
const key = (target: Element, name: string) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  flush();
};
const all = (root: ParentNode, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];

describe("Button", () => {
  it("is a plain button of the chosen variant; an icon button names itself", () => {
    const root = mount(() => (
      <>
        <Button variant="primary">Speichern</Button>
        <IconButton label="Kopieren">·</IconButton>
      </>
    ));
    const [save, copy] = all(root, "button");
    expect(save?.getAttribute("type")).toBe("button");
    expect(save?.className).toContain("bg-primary");
    expect(copy?.getAttribute("aria-label")).toBe("Kopieren");
    expect(copy?.className).toContain("size-8");
  });
});

describe("Badge", () => {
  it("shows the warning tone for ändern", () => {
    const root = mount(() => <Badge tone="warning">ändern</Badge>);
    expect(root.querySelector("span")?.className).toContain("text-warning");
  });
});

describe("Input and SearchInput", () => {
  it("labels the field and points to its hint", () => {
    const root = mount(() => <Input label="Benutzername" hint="So wie auf der Website" />);
    const input = root.querySelector("input") as HTMLInputElement;
    expect(root.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Benutzername");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "So wie auf der Website",
    );
  });

  it("focuses the search on its shortcut, but not while someone types elsewhere", () => {
    const root = mount(() => (
      <>
        <input aria-label="Notiz" />
        <SearchInput label="Suchen" shortcut="/" />
      </>
    ));
    const [note, search] = all(root, "input") as HTMLInputElement[];
    note?.focus();
    key(note as Element, "/");
    expect(document.activeElement).toBe(note);
    note?.blur();
    key(document.body, "/");
    expect(document.activeElement).toBe(search);
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("/");
    key(document.body, "x");
  });
});

describe("List", () => {
  const items = [
    { id: "bank", label: "Sparkasse", description: "weber-haustechnik" },
    { id: "mail", label: "Mail" },
    { id: "wlan", label: "WLAN Büro" },
  ];
  const listed = () => {
    const [selected, setSelected] = createSignal("bank");
    const root = mount(() => (
      <List label="Einträge" items={items} selected={selected()} onSelect={setSelected} />
    ));
    return { root, list: root.querySelector('[role="listbox"]') as HTMLElement };
  };
  const chosen = (root: ParentNode) =>
    all(root, '[aria-selected="true"]').map((el) => el.textContent);

  it("moves the selection with the arrows, Home and End, and names the active option", () => {
    const { root, list } = listed();
    key(list, "ArrowDown");
    expect(chosen(root)).toEqual(["Mail"]);
    key(list, "End");
    expect(chosen(root)).toEqual(["WLAN Büro"]);
    key(list, "ArrowDown");
    expect(chosen(root)).toEqual(["Sparkasseweber-haustechnik"]);
    key(list, "a");
    expect(
      document.getElementById(list.getAttribute("aria-activedescendant") ?? "")?.textContent,
    ).toContain("Sparkasse");
  });

  it("selects an option on click", () => {
    const { root } = listed();
    (all(root, '[role="option"]')[2] as HTMLElement).click();
    flush();
    expect(chosen(root)).toEqual(["WLAN Büro"]);
  });
  it("renders what an option shows around its text once, not again when keys or clicks read the items", () => {
    const made = vi.fn();
    const [selected, setSelected] = createSignal("bank");
    const root = mount(() => (
      <List
        label="Einträge"
        items={items.map((item) => ({
          ...item,
          leading: () => {
            made(item.id);
            return <span class="lead">{item.id}</span>;
          },
          trailing: item.id === "mail" ? () => <b>ändern</b> : undefined,
        }))}
        selected={selected()}
        onSelect={setSelected}
      />
    ));
    expect(all(root, ".lead").map((el) => el.textContent)).toEqual(["bank", "mail", "wlan"]);
    expect(all(root, "b").map((el) => el.textContent)).toEqual(["ändern"]);
    made.mockClear();
    key(root.querySelector('[role="listbox"]') as HTMLElement, "ArrowDown");
    (all(root, '[role="option"]')[2] as HTMLElement).click();
    flush();
    expect(chosen(root)).toEqual(["wlanWLAN Büro"]);
    expect(made).not.toHaveBeenCalled();
  });
});

describe("Tabs", () => {
  it("shows one panel and moves with left, right, Home and End", () => {
    const changes: string[] = [];
    const root = mount(() => (
      <Tabs
        label="Eintrag"
        onChange={(id) => changes.push(id)}
        tabs={[
          { id: "fields", label: "Felder", content: () => <p>Felder</p> },
          { id: "access", label: "Zugriff", content: () => <p>Zugriff</p> },
          { id: "history", label: "Verlauf", content: () => <p>Verlauf</p> },
        ]}
      />
    ));
    const tabs = all(root, '[role="tab"]');
    const visible = () => all(root, '[role="tabpanel"]:not([hidden])').map((p) => p.textContent);
    expect(visible()).toEqual(["Felder"]);
    key(tabs[0] as Element, "ArrowRight");
    expect(visible()).toEqual(["Zugriff"]);
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    key(tabs[1] as Element, "End");
    key(tabs[2] as Element, "ArrowRight");
    expect(visible()).toEqual(["Felder"]);
    key(tabs[0] as Element, "Enter");
    expect(changes).toEqual(["access", "history", "fields"]);
  });
  it("opens on the initial tab and starts over when the parent gives another", () => {
    const [initial, setInitial] = createSignal("access");
    const root = mount(() => (
      <Tabs
        label="Eintrag"
        initial={initial()}
        tabs={[
          { id: "fields", label: "Felder", content: () => <p>Felder</p> },
          { id: "access", label: "Zugriff", content: () => <p>Zugriff</p> },
        ]}
      />
    ));
    const visible = () => all(root, '[role="tabpanel"]:not([hidden])').map((p) => p.textContent);
    expect(visible()).toEqual(["Zugriff"]);
    key(all(root, '[role="tab"]')[1] as Element, "Home");
    expect(visible()).toEqual(["Felder"]);
    setInitial("fields");
    flush();
    setInitial("access");
    flush();
    expect(visible()).toEqual(["Zugriff"]);
  });
  it("keeps the chosen tab when only the tabs' labels change", () => {
    const [count, setCount] = createSignal(1);
    const root = mount(() => (
      <Tabs
        label="Eintrag"
        tabs={[
          { id: "fields", label: "Felder", content: () => <p>Felder</p> },
          { id: "history", label: `Verlauf (${count()})`, content: () => <p>Verlauf</p> },
        ]}
      />
    ));
    const visible = () => all(root, '[role="tabpanel"]:not([hidden])').map((p) => p.textContent);
    key(all(root, '[role="tab"]')[0] as Element, "End");
    expect(visible()).toEqual(["Verlauf"]);
    setCount(2);
    flush();
    expect(all(root, '[role="tab"]')[1]?.textContent).toBe("Verlauf (2)");
    expect(visible()).toEqual(["Verlauf"]);
  });
});

describe("Combobox", () => {
  it("filters ignoring case and spaces at the ends", () => {
    expect(matching(["Büro", "Buchhaltung", "Persönlich"], " bü ")).toEqual(["Büro"]);
    expect(matching(["Büro", "Buchhaltung"], "")).toEqual(["Büro", "Buchhaltung"]);
  });

  it("filters while typing, moves with the arrows and takes an option with Enter; Esc closes, then clears", () => {
    const taken: string[] = [];
    const root = mount(() => (
      <Combobox
        label="Tresor"
        options={["Persönlich", "Büro", "Buchhaltung"]}
        onChange={(v) => taken.push(v)}
      />
    ));
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement;
    input.value = "bu";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    flush();
    expect(all(root, '[role="option"]').map((o) => o.textContent)).toEqual(["Buchhaltung"]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    key(input, "ArrowDown");
    expect(
      document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent,
    ).toBe("Buchhaltung");
    key(input, "Enter");
    expect(taken).toEqual(["Buchhaltung"]);
    expect(input.value).toBe("Buchhaltung");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    key(input, "Escape");
    expect(input.value).toBe("");
  });

  it("says when nothing matches", () => {
    const root = mount(() => <Combobox label="Tresor" options={["Büro"]} onChange={() => {}} />);
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement;
    input.value = "xyz";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    flush();
    expect(root.textContent).toContain("Keine Treffer");
  });
});

describe("Toasts", () => {
  it("expire after a while, but not while held", () => {
    vi.useFakeTimers();
    try {
      const toasts = createToasts();
      const root = mount(() => <Toaster toasts={toasts} />);
      toasts.show("Kopiert");
      flush();
      expect(root.querySelector('[role="status"]')?.textContent).toContain("Kopiert");
      toasts.hold(true);
      vi.advanceTimersByTime(TOAST_MS);
      flush();
      expect(toasts.toasts()).toHaveLength(1);
      toasts.hold(false);
      vi.advanceTimersByTime(TOAST_MS);
      flush();
      expect(toasts.toasts()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes on its button", () => {
    const toasts = createToasts();
    const root = mount(() => <Toaster toasts={toasts} />);
    toasts.show("Gespeichert", "success");
    flush();
    (root.querySelector('button[aria-label="Schließen"]') as HTMLButtonElement).click();
    flush();
    expect(toasts.toasts()).toEqual([]);
  });
});

describe("Tooltip", () => {
  it("stays open while the pointer rests on it and takes its Esc listener away when it goes", () => {
    vi.useFakeTimers();
    const shown = vi.fn();
    const hidden = vi.fn();
    vi.spyOn(HTMLElement.prototype, "showPopover").mockImplementation(shown);
    vi.spyOn(HTMLElement.prototype, "hidePopover").mockImplementation(hidden);
    let open = false;
    shown.mockImplementation(() => {
      open = true;
    });
    hidden.mockImplementation(() => {
      open = false;
    });
    vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
      this: HTMLElement,
      selector: string,
    ) {
      return selector === ":popover-open" ? open : false;
    });
    const removed = vi.spyOn(document, "removeEventListener");
    const root = mount(() => (
      <Tooltip text="Kopieren">{(trigger) => <button type="button" {...trigger} />}</Tooltip>
    ));
    const button = root.querySelector("button") as HTMLElement;
    const tip = root.querySelector('[role="tooltip"]') as HTMLElement;
    button.dispatchEvent(new PointerEvent("pointerenter"));
    button.dispatchEvent(new PointerEvent("pointerleave"));
    tip.dispatchEvent(new PointerEvent("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(open).toBe(true);
    tip.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(500);
    expect(open).toBe(false);
    button.dispatchEvent(new PointerEvent("pointerenter"));
    removed.mockClear();
    dispose();
    dispose = () => {};
    expect(removed).toHaveBeenCalledWith("keydown", expect.any(Function));
    vi.useRealTimers();
  });
});
