import fs from "fs";
import type { ProbeResult } from "../types";
import { runSpawn, type SpawnResult } from "./process";

export function judgeProbe(resultJson: any, info: SpawnResult): ProbeResult {
  const r = resultJson;
  const resp = r && r.tcc_responsible ? r.tcc_responsible : {};
  return {
    ok: !!(r && r.ok === true),
    exitCode: info.code, signal: info.signal, timedOut: !!info.timedOut,
    authorization: r ? (r.authorization ?? null) : null,
    devices_count: r ? (r.devices_count ?? null) : null,
    is_self: resp.is_self === undefined ? null : resp.is_self,
    responsible_comm: resp.responsible_comm ?? null,
    responsible_app: r ? (r.responsible_app ?? null) : null,
    error: r ? (r.error ?? null) : (info.stderr || "").slice(-400) || null,
  };
}

export async function runPreflight(cmd: string, args: string[], resultFile: string, timeoutMs: number): Promise<ProbeResult> {
  try { fs.unlinkSync(resultFile); } catch {}
  const info = await runSpawn(cmd, args, { timeoutMs });
  let r: any = null;
  try { r = JSON.parse(fs.readFileSync(resultFile, "utf8")); } catch {}
  return judgeProbe(r, info);
}
