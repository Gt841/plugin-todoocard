import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import http from "http";
import {
  sha256File, verifySha256, atomicReplaceDir, defaultDownload, withLock,
  extractCommand, isZipUrl, normalizeSourceDir, normalizePythonDir, installCore,
} from "./installer";
import { CoreStore } from "./store";

const COMMIT = "3642b4b25e42e38776f3227db601474173f915b1";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tc-installer-"));

describe("sha256", () => {
  it("matches known vector and verifies", () => {
    const f = path.join(tmp(), "f.txt");
    fs.writeFileSync(f, "abc");
    const h = sha256File(f);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(verifySha256(f, h)).toBe(true);
    expect(verifySha256(f, "deadbeef")).toBe(false);
  });
});

describe("atomicReplaceDir", () => {
  it("replaces dest with tmp content", () => {
    const root = tmp();
    const tmpDir = path.join(root, "tmp"); const dest = path.join(root, "dest");
    fs.mkdirSync(tmpDir); fs.writeFileSync(path.join(tmpDir, "new"), "N");
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, "old"), "O");
    atomicReplaceDir(tmpDir, dest);
    expect(fs.existsSync(path.join(dest, "new"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "old"))).toBe(false);
  });
});

describe("withLock stale-lock recovery", () => {
  it("recovers a lock left by a dead pid", async () => {
    const dir = tmp();
    const lock = path.join(dir, "install.lock");
    fs.writeFileSync(lock, "999999"); // not a live pid on macOS/Linux test hosts
    let ran = false;
    await withLock(lock, async () => { ran = true; });
    expect(ran).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });
  it("rejects when the lock is held by a live pid", async () => {
    const dir = tmp();
    const lock = path.join(dir, "install.lock");
    fs.writeFileSync(lock, String(process.pid));
    await expect(withLock(lock, async () => {})).rejects.toThrow("already in progress");
  });
});

describe("atomicReplaceDir rollback", () => {
  it("restores dest when the second rename fails", () => {
    const root = tmp();
    const tmpDir = path.join(root, "tmp"); const dest = path.join(root, "dest");
    fs.mkdirSync(tmpDir); fs.writeFileSync(path.join(tmpDir, "new"), "N");
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, "old"), "O");
    const real = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync")
      .mockImplementationOnce(real as any)
      .mockImplementationOnce((() => { throw new Error("boom"); }) as any);
    expect(() => atomicReplaceDir(tmpDir, dest)).toThrow("boom");
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
    const dest = path.join(tmp(), "f.bin");
    await expect(defaultDownload(`http://127.0.0.1:${port}/x`, dest, 3000)).rejects.toBeTruthy();
    server.close();
  }, 8000);
  it("rejects on timeout when the server never responds", async () => {
    const server = http.createServer(() => { /* never respond */ });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const dest = path.join(tmp(), "f.bin");
    await expect(defaultDownload(`http://127.0.0.1:${port}/x`, dest, 300)).rejects.toThrow("timeout");
    server.close();
  }, 8000);
});

describe("normalizeSourceDir", () => {
  it("peels the todoocard-eink-<commit> top level", () => {
    const root = tmp();
    const raw = path.join(root, "src_raw");
    const top = path.join(raw, `todoocard-eink-${COMMIT}`);
    fs.mkdirSync(top, { recursive: true });
    fs.writeFileSync(path.join(top, "server.py"), "upstream");
    const out = path.join(root, "stage", "eink");
    normalizeSourceDir(raw, COMMIT, out);
    expect(fs.readFileSync(path.join(out, "server.py"), "utf8")).toBe("upstream");
  });
  it("is idempotent for an already flat layout", () => {
    const root = tmp();
    const raw = path.join(root, "src_raw");
    fs.mkdirSync(raw);
    fs.writeFileSync(path.join(raw, "server.py"), "flat");
    const out = path.join(root, "stage", "eink");
    normalizeSourceDir(raw, COMMIT, out);
    expect(fs.readFileSync(path.join(out, "server.py"), "utf8")).toBe("flat");
  });
  it("rejects a top-level dir that does not match coreCommit", () => {
    const root = tmp();
    const raw = path.join(root, "src_raw");
    fs.mkdirSync(path.join(raw, "todoocard-eink-deadbeef"), { recursive: true });
    expect(() => normalizeSourceDir(raw, COMMIT, path.join(root, "eink")))
      .toThrow(/coreCommit 不符/);
  });
  it("rejects when server.py is missing after peeling", () => {
    const root = tmp();
    const raw = path.join(root, "src_raw");
    fs.mkdirSync(path.join(raw, `todoocard-eink-${COMMIT}`), { recursive: true });
    expect(() => normalizeSourceDir(raw, COMMIT, path.join(root, "eink")))
      .toThrow(/缺少 server.py/);
  });
});

describe("normalizePythonDir", () => {
  it("peels the python/ top level", () => {
    const root = tmp();
    const raw = path.join(root, "py_raw");
    fs.mkdirSync(path.join(raw, "python", "bin"), { recursive: true });
    fs.writeFileSync(path.join(raw, "python", "bin", "python3"), "");
    const out = path.join(root, "stage", "python");
    normalizePythonDir(raw, out, "darwin");
    expect(fs.existsSync(path.join(out, "bin", "python3"))).toBe(true);
  });
  it("is idempotent for an already flat layout", () => {
    const root = tmp();
    const raw = path.join(root, "py_raw");
    fs.mkdirSync(path.join(raw, "bin"), { recursive: true });
    fs.writeFileSync(path.join(raw, "bin", "python3"), "");
    const out = path.join(root, "stage", "python");
    normalizePythonDir(raw, out, "darwin");
    expect(fs.existsSync(path.join(out, "bin", "python3"))).toBe(true);
  });
  it("rejects a missing python executable", () => {
    const root = tmp();
    const raw = path.join(root, "py_raw");
    fs.mkdirSync(path.join(raw, "python"), { recursive: true });
    expect(() => normalizePythonDir(raw, path.join(root, "stage", "python"), "darwin"))
      .toThrow(/布局异常/);
  });
});

describe("installCore (v2)", () => {
  const payloads: Record<string, string> = { source: "SRC", python: "PY", extension: "EXT" };
  const entry = {
    sourceUrl: "https://x/source.tar.gz", sourceSha256: sha(payloads.source),
    pythonUrl: "https://x/python.tar.gz", pythonSha256: sha(payloads.python),
    extensionUrl: "https://x/extension.zip", extensionSha256: sha(payloads.extension),
  };

  function harness() {
    const root = tmp();
    const store = new CoreStore(path.join(root, "core"), "darwin");
    const calls: { cmd: string; args: string[] }[] = [];
    const downloads: string[] = [];
    const download = async (url: string, dest: string) => {
      downloads.push(url);
      const key = url.includes("source") ? "source" : url.includes("python") ? "python" : "extension";
      fs.writeFileSync(dest, payloads[key]);
    };
    const extract = async (archive: string, dest: string) => {
      if (archive.endsWith("source.tar.gz")) {
        const top = path.join(dest, `todoocard-eink-${COMMIT}`);
        fs.mkdirSync(top, { recursive: true });
        fs.writeFileSync(path.join(top, "server.py"), "patched-core");
        fs.writeFileSync(path.join(top, "requirements.txt"), "");
      } else if (archive.endsWith("python.tar.gz")) {
        fs.mkdirSync(path.join(dest, "python", "bin"), { recursive: true });
        fs.writeFileSync(path.join(dest, "python", "bin", "python3"), "");
      } else {
        fs.writeFileSync(path.join(dest, "apply.py"), "");
      }
    };
    const spawn = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" } as any;
    };
    const base = {
      store, entry, version: "2.0.0", coreVersion: "1.0.11", coreCommit: COMMIT,
      manifestUrl: "file:///tmp/manifest.json", platform: "darwin", arch: "arm64",
      download, extract, spawn,
    };
    const seedOldCore = () => {
      fs.mkdirSync(path.join(store.coreDir, "eink"), { recursive: true });
      fs.writeFileSync(store.paths.serverPy, "OLD-CORE");
    };
    return { root, store, calls, downloads, base, seedOldCore };
  }

  it("downloads three assets, runs pip + apply.py, atomically replaces and writes core.json v2", async () => {
    const { store, calls, downloads, base } = harness();
    await installCore(base);
    expect(downloads).toEqual([entry.sourceUrl, entry.pythonUrl, entry.extensionUrl]);
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("patched-core");
    expect(fs.existsSync(store.paths.python)).toBe(true);
    const cj = store.readCoreJson()!;
    expect(cj.coreVersion).toBe("1.0.11");
    expect(cj.coreCommit).toBe(COMMIT);
    expect(cj.source).toEqual({
      manifestUrl: "file:///tmp/manifest.json",
      sourceSha256: entry.sourceSha256, pythonSha256: entry.pythonSha256,
      extensionSha256: entry.extensionSha256,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].args.slice(0, 3)).toEqual(["-m", "pip", "install"]);
    expect(calls[1].args[0]).toMatch(/apply\.py$/);
    expect(calls[1].args).toContain("--core-version");
    expect(calls[1].args).toContain("1.0.11");
    expect(calls[1].args).toContain("--core-commit");
    expect(calls[1].args).toContain(COMMIT);
  });

  it("aborts on source sha256 mismatch and leaves the old core intact", async () => {
    const { store, calls, base, seedOldCore } = harness();
    seedOldCore();
    await expect(installCore({ ...base, entry: { ...entry, sourceSha256: "deadbeef" } }))
      .rejects.toThrow("source sha256 mismatch");
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("OLD-CORE");
    expect(calls).toHaveLength(0);
  });

  it("aborts on extension sha256 mismatch and leaves the old core intact", async () => {
    const { store, calls, base, seedOldCore } = harness();
    seedOldCore();
    await expect(installCore({ ...base, entry: { ...entry, extensionSha256: "deadbeef" } }))
      .rejects.toThrow("extension sha256 mismatch");
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("OLD-CORE");
    expect(calls).toHaveLength(0);
  });

  it("aborts when apply.py exits non-zero, before atomic replace", async () => {
    const { store, base, seedOldCore } = harness();
    seedOldCore();
    const failingSpawn = async (_cmd: string, args: string[]) => ({
      code: args[0].endsWith("apply.py") ? 1 : 0,
      stdout: "", stderr: "anchor drift",
    }) as any;
    await expect(installCore({ ...base, spawn: failingSpawn }))
      .rejects.toThrow(/扩展补丁失败/);
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("OLD-CORE");
  });

  it("aborts when pip fails, before apply.py and atomic replace", async () => {
    const { store, calls, base, seedOldCore } = harness();
    seedOldCore();
    const failingSpawn = async (_cmd: string, args: string[]) => ({
      code: args.includes("pip") ? 1 : 0,
      stdout: "", stderr: "no network",
    }) as any;
    await expect(installCore({ ...base, spawn: failingSpawn }))
      .rejects.toThrow(/pip install failed/);
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("OLD-CORE");
    expect(calls).toHaveLength(0);
  });

  it("aborts when the extension zip has no apply.py", async () => {
    const { store, base, seedOldCore } = harness();
    seedOldCore();
    const noApply = async (archive: string, dest: string) => {
      if (archive.endsWith("extension.zip")) return;
      return (base.extract as any)(archive, dest);
    };
    await expect(installCore({ ...base, extract: noApply }))
      .rejects.toThrow(/缺少 apply.py/);
    expect(fs.readFileSync(store.paths.serverPy, "utf8")).toBe("OLD-CORE");
  });
});
