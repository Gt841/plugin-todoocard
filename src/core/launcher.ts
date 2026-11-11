import type { LaunchMode, ProbeResult } from "../types";

export async function selectMode(
  modes: LaunchMode[],
  probe: (m: LaunchMode) => Promise<ProbeResult>,
): Promise<{ mode: LaunchMode | null; results: { mode: LaunchMode; result: ProbeResult }[] }> {
  const results: { mode: LaunchMode; result: ProbeResult }[] = [];
  for (const m of modes) {
    const result = await probe(m);
    results.push({ mode: m, result });
    if (result.ok) return { mode: m, results };
  }
  return { mode: null, results };
}
