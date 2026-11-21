import { describe, expect, it } from "vitest";
import { mountpunkte, platten } from "./platten.ts";
import { testQuellen } from "./testquellen.ts";

// /proc/mounts of a Debian 13 server with a separate /home and /boot, Podman's overlay of a running
// container, a snap and a mount point with a space (escaped as \040, proc(5))
const MOUNTS = [
  "sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0",
  "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
  "/dev/sda1 / ext4 rw,relatime,errors=remount-ro 0 0",
  "tmpfs /run tmpfs rw,nosuid,nodev,size=802936k,mode=755 0 0",
  "/dev/sda15 /boot/efi vfat rw,relatime,fmask=0022 0 0",
  "/dev/sda2 /boot ext4 rw,relatime 0 0",
  "/dev/sdb1 /home xfs rw,relatime,attr2,inode64 0 0",
  "/dev/sdb1 /home xfs rw,relatime,attr2,inode64 0 0",
  "overlay /home/sz-haben-k1/.local/share/containers/storage/overlay/abc/merged overlay rw 0 0",
  "/dev/loop0 /snap/core22/1663 squashfs ro,nodev,relatime 0 0",
  "/dev/sdc1 /srv/alte\\040daten ext4 ro,relatime 0 0",
  "/dev/sdd1 /srv/neue\\040daten btrfs rw,relatime 0 0",
].join("\n");

describe("mount points", () => {
  it("keeps the writable disk file systems and the root, once each", () => {
    expect(mountpunkte(MOUNTS)).toEqual(["/", "/boot", "/home", "/srv/neue daten"]);
  });

  it("keeps the root of a container, whatever its file system", () => {
    expect(
      mountpunkte("overlay / overlay rw,relatime,lowerdir=/x 0 0\nproc /proc proc rw 0 0"),
    ).toEqual(["/"]);
  });
});

describe("disks", () => {
  it("measures each mount point", async () => {
    const q = testQuellen({
      dateien: { "/proc/mounts": "/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /home xfs rw 0 0" },
      platz: async (mount) =>
        mount === "/" ? { gesamtMb: 20_000, freiMb: 12_000 } : { gesamtMb: 500_000, freiMb: 1 },
    });
    expect(await platten(q)).toEqual([
      { mount: "/", gesamtMb: 20_000, freiMb: 12_000 },
      { mount: "/home", gesamtMb: 500_000, freiMb: 1 },
    ]);
  });

  it("leaves out a mount it cannot measure, and is null without /proc/mounts", async () => {
    const q = testQuellen({
      dateien: { "/proc/mounts": "/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /home xfs rw 0 0" },
      platz: async (mount) => (mount === "/" ? { gesamtMb: 1, freiMb: 1 } : undefined),
    });
    expect(await platten(q)).toEqual([{ mount: "/", gesamtMb: 1, freiMb: 1 }]);
    expect(await platten(testQuellen())).toBeNull();
  });
});
