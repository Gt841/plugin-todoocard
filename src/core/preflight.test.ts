import { describe, it, expect } from "vitest";
import { judgeProbe } from "./preflight";

const info = { code: 0, signal: null, stdout: "", stderr: "", timedOut: false };

describe("judgeProbe", () => {
  it("ok when result.ok true", () => {
    const j = judgeProbe({ ok: true, authorization: "allowedAlways", devices_count: 5, tcc_responsible: { is_self: true, responsible_comm: "python" } }, info);
    expect(j.ok).toBe(true);
    expect(j.devices_count).toBe(5);
    expect(j.is_self).toBe(true);
  });
  it("fail when result missing (TCC killed before write)", () => {
    const j = judgeProbe(null, { code: null, signal: "SIGABRT", stdout: "", stderr: "", timedOut: false });
    expect(j.ok).toBe(false);
    expect(j.signal).toBe("SIGABRT");
  });
  it("fail when result.ok false", () => {
    const j = judgeProbe({ ok: false, error: "denied" }, info);
    expect(j.ok).toBe(false);
    expect(j.error).toBe("denied");
  });
  it("fail on timeout", () => {
    const j = judgeProbe(null, { code: null, signal: "SIGKILL", stdout: "", stderr: "", timedOut: true });
    expect(j.ok).toBe(false);
    expect(j.timedOut).toBe(true);
  });
});
