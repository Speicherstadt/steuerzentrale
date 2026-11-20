import { m } from "@steuerzentrale/ui";

/** The start page until Z-105 builds the shell from design/mockup/ */
export const App = () => (
  <main class="mx-auto max-w-2xl p-6">
    <h1 class="text-2xl font-semibold">{m.app_name()}</h1>
    <p class="mt-2 text-muted-foreground">{m.app_tagline()}</p>
  </main>
);
