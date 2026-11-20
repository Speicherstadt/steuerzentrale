import { Icon, m } from "@steuerzentrale/ui";
import { CalendarX } from "@steuerzentrale/ui/icons";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import {
  betrifft,
  installationenVon,
  monatVon,
  serverVonKunde,
  suche,
  supportMinuten,
} from "../daten/ableitungen.ts";
import { bestand } from "../daten/quelle.ts";
import type { Bestand, Ereignis, Kunde } from "../daten/typen.ts";
import { minuten } from "../format/zahl.ts";
import { datum } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";
import { InstallationsListe } from "../seiten/installations-liste.tsx";
import { Angaben, Hinweisbox, Karte, KartenInhalt, KartenKopf } from "../teile/karte.tsx";
import { Ereignisliste } from "../teile/listen.tsx";
import { Marke } from "../teile/zeichen.tsx";

/** One customer: contract, installations, events and support accesses (Z-801, Z-802) */

/** Events of the customer's installations and their support accesses, newest first */
const verlauf = (b: Bestand, k: Kunde): Ereignis[] => {
  const ids = new Set(installationenVon(b, k.id).map((i) => i.id));
  const zugaenge: Ereignis[] = b.zugaenge
    .filter((z) => ids.has(z.installation))
    .map((z) => ({
      zeit: z.start,
      schwere: "info",
      ziel: { art: "installation", id: z.installation },
      text: m.kunde_zugang({
        wer: z.wer,
        dauer: z.restMinuten === undefined ? minuten(z.minuten) : m.kunde_zugang_aktiv(),
        grund: z.grund,
      }),
    }));
  return [...b.ereignisse.filter((e) => betrifft(e.ziel, ids)), ...zugaenge].sort(
    (x, y) => y.zeit - x.zeit,
  );
};

const initialen = (name: string) =>
  name
    .split(" ")
    .map((teil) => teil[0])
    .join("")
    .slice(0, 2);

const Detail = (props: { k: Kunde }) => {
  const b = bestand();
  const installationen = () => installationenVon(b, props.k.id);
  return (
    <div class="grid gap-4">
      <div class="flex min-w-0 items-center gap-4">
        <span
          aria-hidden="true"
          class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent font-medium"
        >
          {initialen(props.k.name)}
        </span>
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold tracking-tight">{props.k.name}</h1>
            <Marke class="bg-accent">{m.kunde_sla({ sla: m.sla_basis() })}</Marke>
          </div>
          <p class="text-muted-foreground">
            {m.kunde_kontakt({ kontakt: props.k.kontakt, seit: datum(props.k.seit) })}
          </p>
        </div>
      </div>
      <Show when={props.k.gekuendigt}>
        {(g) => (
          <Hinweisbox
            icon={<Icon icon={CalendarX} />}
            titel={m.kunde_gekuendigt_zum({ datum: datum(g().zum) })}
          >
            {m.kunde_gekuendigt_text({ datum: datum(g().loeschung) })}
          </Hinweisbox>
        )}
      </Show>
      <div class="grid gap-4 lg:grid-cols-3">
        <Karte>
          <KartenKopf titel={m.kunde_vertrag()} />
          <KartenInhalt>
            <Angaben
              zeilen={[
                { name: m.kunden_spalte_sla(), wert: m.sla_basis() },
                { name: m.kunde_bedeutet(), wert: m.sla_basis_text() },
                { name: m.inst_welle(), wert: welleName(props.k.intern ? "intern" : "alle") },
                {
                  name: m.kunde_support_monat(),
                  wert: minuten(supportMinuten(b, props.k.id, monatVon(b.jetzt))),
                },
              ]}
            />
          </KartenInhalt>
        </Karte>
        <Karte class="lg:col-span-2">
          <KartenKopf
            titel={m.nav_installationen()}
            text={m.kunde_installationen_text({
              n: installationen().length,
              server: serverVonKunde(b, props.k.id).length,
            })}
          />
          <KartenInhalt>
            <InstallationsListe installationen={installationen()} zeige="app" />
          </KartenInhalt>
        </Karte>
      </div>
      <Karte>
        <KartenKopf titel={m.kunde_verlauf()} text={m.kunde_verlauf_text()} />
        <KartenInhalt>
          <Ereignisliste ereignisse={verlauf(b, props.k)} />
        </KartenInhalt>
      </Karte>
    </div>
  );
};

const KundeSeite = () => {
  const k = Route.useLoaderData();
  return <Detail k={k()} />;
};

export const Route = createFileRoute("/kunden/$id")({
  loader: ({ params }) => {
    const k = suche(bestand().kunden, params.id);
    if (!k) throw notFound();
    return k;
  },
  component: KundeSeite,
});
