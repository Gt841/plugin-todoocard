import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { sha256File, verifySha256, atomicReplaceDir } from "./installer";

describe("sha256", () => {
  it("matches known vector and verifies", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sha-")), "f.txt");
    fs.writeFileSync(f, "abc");
    const h = sha256File(f);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(verifySha256(f, h)).toBe(true);
    expect(verifySha256(f, "deadbeef")).toBe(false);
  });
});

describe("atomicReplaceDir", () => {
  it("replaces dest with tmp content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atom-"));
    const tmp = path.join(root, "tmp"); const dest = path.join(root, "dest");
    fs.mkdirSync(tmp); fs.writeFileSync(path.join(tmp, "new"), "N");
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, "old"), "O");
    atomicReplaceDir(tmp, dest);
    expect(fs.existsSync(path.join(dest, "new"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "old"))).toBe(false);
  });
});