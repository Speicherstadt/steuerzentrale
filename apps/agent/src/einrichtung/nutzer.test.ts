import { describe, expect, it } from "vitest";
import { alsNutzer, nutzerAusPasswd, passwdEintrag } from "./nutzer.ts";

/* docs/plan.md, "Einrichten auf dem Server": the user of an installation and how root runs as it */

const PASSWD = [
  "root:x:0:0:root:/root:/bin/bash",
  "sz-pforte:x:1500:1500:Pforte der Steuerzentrale:/home/sz-pforte:/usr/sbin/nologin",
  "sz-haben-k1:x:2001:2001:Steuerzentrale haben-k1:/home/sz-haben-k1:/usr/sbin/nologin",
  "kaputt:x:abc:1:::/bin/sh",
  "",
].join("\n");

describe("passwdEintrag", () => {
  it("reads name, uid, gid and home of a user", () => {
    expect(passwdEintrag(PASSWD, "sz-haben-k1")).toEqual({
      name: "sz-haben-k1",
      uid: 2001,
      gid: 2001,
      home: "/home/sz-haben-k1",
    });
  });

  it("knows no user that is not there, and none that is only a prefix of one", () => {
    expect(passwdEintrag(PASSWD, "sz-haben")).toBeUndefined();
    expect(passwdEintrag(PASSWD, "")).toBeUndefined();
  });

  it("takes a broken entry for none", () => {
    expect(passwdEintrag(PASSWD, "kaputt")).toBeUndefined();
  });

  it("reads the file on every call: users come and go while the agent runs", async () => {
    let text = "";
    const lesen = nutzerAusPasswd(async () => text);
    expect(await lesen("sz-pforte")).toBeUndefined();
    text = PASSWD;
    expect(await lesen("sz-pforte")).toMatchObject({ uid: 1500 });
  });
});

describe("alsNutzer", () => {
  it("runs a fixed argv as the user, with only the environment it sets and no shell", () => {
    expect(
      alsNutzer({ name: "sz-a", uid: 2001, gid: 2001, home: "/home/sz-a" }, ["podman", "ps"]),
    ).toEqual([
      "runuser",
      "-u",
      "sz-a",
      "--",
      "env",
      "-i",
      "HOME=/home/sz-a",
      "USER=sz-a",
      "LOGNAME=sz-a",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "XDG_RUNTIME_DIR=/run/user/2001",
      "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/2001/bus",
      "podman",
      "ps",
    ]);
  });
});
