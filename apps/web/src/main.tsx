import "@steuerzentrale/ui/styles.css";
import { render } from "@solidjs/web";
import { getLocale } from "@steuerzentrale/ui";
import { App } from "./app.tsx";

const root = document.getElementById("root");
if (root) {
  document.documentElement.lang = getLocale();
  render(() => <App />, root);
}
