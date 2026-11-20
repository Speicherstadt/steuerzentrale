// The components of the Zentrale's UI (DESIGN.md) and the texts, compiled by Paraglide from
// messages/de.json and messages/en.json. Copied from Speicherstadt/kennwort, packages/ui
// (commit b1ee742), so the suite shares one look.

export { Badge, type BadgeProps } from "./components/badge.tsx";
export { Button, type ButtonProps, buttonClass, IconButton } from "./components/button.tsx";
export { Combobox, type ComboboxProps, matching } from "./components/combobox.tsx";
export { Dialog, type DialogProps } from "./components/dialog.tsx";
export { Icon, type IconProps } from "./components/icon.tsx";
export {
  Input,
  type InputProps,
  SearchInput,
  TextArea,
  type TextAreaProps,
} from "./components/input.tsx";
export { List, type ListItem, type ListProps } from "./components/list.tsx";
export { Menu, type MenuItem, type MenuProps } from "./components/menu.tsx";
export { Popover, type PopoverProps } from "./components/popover.tsx";
export { type Tab, Tabs, type TabsProps } from "./components/tabs.tsx";
export { createToasts, TOAST_MS, type Toast, Toaster, type Toasts } from "./components/toast.tsx";
export { Tooltip, type TooltipProps } from "./components/tooltip.tsx";
export { cn } from "./lib/cn.ts";
export { nextIndex, type Orientation } from "./lib/keys.ts";
export { type VariantProps, variants } from "./lib/variants.ts";
export { m } from "./paraglide/messages.js";
export type { Locale } from "./paraglide/runtime.js";
export { getLocale, locales, setLocale } from "./paraglide/runtime.js";
