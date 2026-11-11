import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runSpawn, writePid, readPid } from "./process";

describe("runSpawn", () => {
  it("captures stdout and exit 0", async () => {
    const r = await runSpawn(process.execPath, ["-e", "console.log('hi')"], { timeoutMs: 8000 });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.timedOut).toBe(false);
  });
  it("flags timeout and kills", async () => {
    const r = await runSpawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe("SIGKILL");
  });
});

describe("pid file", () => {
  it("round-trips", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pid-")), "core.pid");
    writePid(f, 4321);
    expect(readPid(f)).toBe(4321);
  });
  it("readPid null on missing/garbage", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "pid-"));
    expect(readPid(path.join(d, "none"))).toBeNull();
    const f = path.join(d, "bad"); fs.writeFileSync(f, "abc");
    expect(readPid(f)).toBeNull();
  });
});