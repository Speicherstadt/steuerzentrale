import { m } from "@steuerzentrale/ui";

/** An unknown path or an object that does not exist (or not for this operator) */
export const NichtGefunden = () => (
  <div class="grid gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">{m.nicht_gefunden_titel()}</h1>
    <p class="text-muted-foreground">{m.nicht_gefunden_text()}</p>
  </div>
);
