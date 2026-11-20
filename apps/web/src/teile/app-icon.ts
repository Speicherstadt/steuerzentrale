import {
  Archive,
  BookOpenCheck,
  FolderSync,
  type IconNode,
  KeyRound,
  MessagesSquare,
  Package,
  PenLine,
  Ruler,
  Timer,
} from "@steuerzentrale/ui/icons";

/**
 * The icon a manifest names, by its lucide name; an unknown name shows a package, so a new app
 * needs no change here to appear
 */
const ICONS: Record<string, IconNode> = {
  archive: Archive,
  "book-open-check": BookOpenCheck,
  "folder-sync": FolderSync,
  "key-round": KeyRound,
  "messages-square": MessagesSquare,
  "pen-line": PenLine,
  ruler: Ruler,
  timer: Timer,
};

export const appIcon = (name: string): IconNode => ICONS[name] ?? Package;
