import path from "path";
import { describe, expect, it } from "vitest";
import { isInside, resolveStateDir, statePaths } from "./paths";

describe("resolveStateDir", () => {
  it("以 workspace 的 data/ 上一级为准（~/Library/Application Support/SiYuan/todoocard）", () => {
    const dir = resolveStateDir({
      userData: "/Users/me/Library/Application Support/SiYuan-Electron",
      dataDir: "/Users/me/Library/Application Support/SiYuan/data",
      home: "/Users/me",
      platform: "darwin",
    });
    expect(dir).toBe("/Users/me/Library/Application Support/SiYuan/todoocard");
  });

  it("没有 dataDir 时把 Electron 的 SiYuan-Electron 映射回 SiYuan", () => {
    const dir = resolveStateDir({
      userData: "/Users/me/Library/Application Support/SiYuan-Electron",
      home: "/Users/me",
      platform: "darwin",
    });
    expect(dir).toBe("/Users/me/Library/Application Support/SiYuan/todoocard");
  });

  it("非 macOS 且没有 userData 时使用 home 兜底", () => {
    const dir = resolveStateDir({ home: "/home/me", platform: "linux" });
    expect(dir).toBe("/home/me/.siyuan-todoocard");
  });
});

describe("isInside", () => {
  it("识别目录边界", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a")).toBe(false);
  });
});

describe("statePaths", () => {
  it("所有状态文件都落在 stateDir 内", () => {
    const p = statePaths("/x/todoocard");
    expect(p.stateFile).toBe(path.join("/x/todoocard", "state.json"));
    expect(p.skillDir).toBe(path.join("/x/todoocard", "skill"));
    expect(p.skillMetaFile).toBe(path.join("/x/todoocard", "skill-meta.json"));
  });
});
