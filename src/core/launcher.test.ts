import { describe, it, expect } from "vitest";
import { selectMode } from "./launcher";
import type { ProbeResult } from "../types";

const ok: ProbeResult = { ok: true, exitCode: 0, signal: null, timedOut: false, authorization: "allowedAlways", devices_count: 3, is_self: false, responsible_comm: null, responsible_app: null, error: null };
const bad: ProbeResult = { ...ok, ok: false, signal: "SIGABRT" };

describe("selectMode", () => {
  it("stops at first ok (①)", async () => {
    const seen: string[] = [];
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => { seen.push(m); return ok; });
    expect(r.mode).toBe("direct");
    expect(seen).toEqual(["direct"]);
  });
  it("falls back ①→② when ① fails", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "direct" ? bad : ok);
    expect(r.mode).toBe("disclaim");
    expect(r.results.map((x) => x.mode)).toEqual(["direct", "disclaim"]);
  });
  it("falls back to ④ when ①② fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "terminal" ? ok : bad);
    expect(r.mode).toBe("terminal");
  });
  it("null when all fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async () => bad);
    expect(r.mode).toBeNull();
    expect(r.results).toHaveLength(3);
  });
});
