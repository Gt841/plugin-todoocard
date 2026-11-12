import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { sha256File, verifySha256, atomicReplaceDir, defaultDownload, withLock, extractCommand, isZipUrl } from "./installer";

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

describe("withLock stale-lock recovery", () => {
  it("recovers a lock left by a dead pid", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    const lock = path.join(dir, "install.lock");
    fs.writeFileSync(lock, "999999"); // not a live pid on macOS/Linux test hosts
    let ran = false;
    await withLock(lock, async () => { ran = true; });
    expect(ran).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });
  it("rejects when the lock is held by a live pid", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    const lock = path.join(dir, "install.lock");
    fs.writeFileSync(lock, String(process.pid));
    await expect(withLock(lock, async () => {})).rejects.toThrow("already in progress");
  });
});

describe("atomicReplaceDir rollback", () => {
  it("restores dest when the second rename fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atom-"));
    const tmp = path.join(root, "tmp"); const dest = path.join(root, "dest");
    fs.mkdirSync(tmp); fs.writeFileSync(path.join(tmp, "new"), "N");
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, "old"), "O");
    const real = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync")
      .mockImplementationOnce(real as any)
      .mockImplementationOnce((() => { throw new Error("boom"); }) as any);
    expect(() => atomicReplaceDir(tmp, dest)).toThrow("boom");
    spy.mockRestore();
    expect(fs.existsSync(path.join(dest, "old"))).toBe(true);
  });
});

describe("extractCommand", () => {
  it("win32 zip uses Expand-Archive", () => {
    const c = extractCommand("C:\\a\\p.zip", "C:\\a\\out", "win32", true);
    expect(c.cmd).toBe("powershell"); expect(c.args.join(" ")).toContain("Expand-Archive");
  });
  it("win32 tar.gz uses tar -xf", () => {
    const c = extractCommand("C:\\a\\p.tar.gz", "C:\\a\\out", "win32", false);
    expect(c.cmd).toBe("tar"); expect(c.args).toContain("-xf");
  });
  it("darwin zip uses unzip", () => {
    expect(extractCommand("/a/e.zip", "/a/out", "darwin", true).cmd).toBe("unzip");
  });
  it("linux tar.gz uses tar -xzf", () => {
    const c = extractCommand("/a/p.tar.gz", "/a/out", "linux", false);
    expect(c.cmd).toBe("tar"); expect(c.args).toContain("-xzf");
  });
  it("isZipUrl ignores query/hash", () => {
    expect(isZipUrl("https://x/p.zip?v=1")).toBe(true);
    expect(isZipUrl("https://x/p.tar.gz")).toBe(false);
  });
});

describe("defaultDownload settles on connection reset", () => {
  it("rejects (does not hang) when the socket is destroyed mid-body", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": "1000000" });
      res.write("partial");
      setTimeout(() => { res.socket?.destroy(); }, 20);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dl-")), "f.bin");
    await expect(defaultDownload(`http://127.0.0.1:${port}/x`, dest, 3000)).rejects.toBeTruthy();
    server.close();
  }, 8000);
  it("rejects on timeout when the server never responds", async () => {
    const server = http.createServer(() => { /* never respond */ });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dl-")), "f.bin");
    await expect(defaultDownload(`http://127.0.0.1:${port}/x`, dest, 300)).rejects.toThrow("timeout");
    server.close();
  }, 8000);
});
