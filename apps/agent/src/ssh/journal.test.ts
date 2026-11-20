import { describe, expect, it } from "vitest";
import { echtFolgen, zeilenVon } from "./journal.ts";

const strom = (stuecke: string[]) =>
  new ReadableStream<Uint8Array>({
    start: (c) => {
      for (const s of stuecke) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });

const alle = async (it: AsyncIterable<string>) => {
  const zeilen: string[] = [];
  for await (const z of it) zeilen.push(z);
  return zeilen;
};

describe("lines of the journal", () => {
  it("come whole, however the bytes are cut, and a multi-byte character too", async () => {
    const ue = new TextEncoder().encode("ü");
    const s = new ReadableStream<Uint8Array>({
      start: (c) => {
        c.enqueue(new TextEncoder().encode('{"a":1}\n{"b":"'));
        c.enqueue(ue.slice(0, 1));
        c.enqueue(ue.slice(1));
        c.enqueue(new TextEncoder().encode('"}\nletzte'));
        c.close();
      },
    });
    expect(await alle(zeilenVon(s))).toEqual(['{"a":1}', '{"b":"ü"}', "letzte"]);
    expect(await alle(zeilenVon(strom([])))).toEqual([]);
  });

  it("are none when the command does not exist", async () => {
    const j = echtFolgen(["sz-test-gibt-es-nicht"]);
    expect(await alle(j.zeilen)).toEqual([]);
    j.stoppen();
  });
});
