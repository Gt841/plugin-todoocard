import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_URL, PINNED_COMMIT, PINNED_SHA256 } from "./store";
import {
  detectSkill,
  expectedSha256For,
  installSkill,
  normalizeSkillDir,
  readSkillMeta,
  sourceToArchiveUrl,
} from "./skill";

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-skill-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeSkill(root: string) {
  const scripts = path.join(root, "todoocard-skills", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "prepare_and_send.sh"), "#!/bin/bash\n", "utf8");
}

describe("sourceToArchiveUrl", () => {
  it("钉死 commit 时使用裸 sha 的 tarball", () => {
    expect(sourceToArchiveUrl(DEFAULT_SOURCE_URL)).toBe(
      `https://codeload.github.com/Sunbelife/TodooCard_Skills/tar.gz/${PINNED_COMMIT}`,
    );
  });

  it("普通仓库和 tree 分支走 refs/heads", () => {
    expect(sourceToArchiveUrl("https://github.com/a/b")).toBe("https://codeload.github.com/a/b/tar.gz/refs/heads/main");
    expect(sourceToArchiveUrl("https://github.com/a/b/tree/dev")).toBe("https://codeload.github.com/a/b/tar.gz/refs/heads/dev");
  });

  it("压缩包直链原样返回，非法地址报错", () => {
    expect(sourceToArchiveUrl("https://example.com/x.tar.gz")).toBe("https://example.com/x.tar.gz");
    expect(() => sourceToArchiveUrl("https://example.com/x")).toThrow("Skill 地址");
  });
});

describe("expectedSha256For", () => {
  it("默认钉死来源返回固定摘要，其他来源不强校验", () => {
    expect(expectedSha256For(DEFAULT_SOURCE_URL)).toBe(PINNED_SHA256);
    expect(expectedSha256For(`${DEFAULT_SOURCE_URL}/`)).toBe(PINNED_SHA256);
    expect(expectedSha256For("https://github.com/Sunbelife/TodooCard_Skills")).toBeNull();
    expect(expectedSha256For(`https://github.com/Sunbelife/TodooCard_Skills/tree/${PINNED_COMMIT}`)).toBeNull();
    expect(expectedSha256For(`https://github.com/other/repo/commit/${PINNED_COMMIT}`)).toBeNull();
  });
});

describe("normalizeSkillDir", () => {
  it("剥掉 GitHub tarball 顶层目录", () => {
    const root = tempDir();
    const raw = path.join(root, "raw");
    const nested = path.join(raw, "TodooCard_Skills-abc");
    writeSkill(nested);
    const layout = normalizeSkillDir(raw, path.join(root, "stage", "skill"));
    expect(layout.ref).toBe("TodooCard_Skills-abc");
    expect(fs.existsSync(path.join(layout.scriptsDir, "prepare_and_send.sh"))).toBe(true);
    expect(fs.existsSync(nested)).toBe(false);
  });

  it("目录结构不对时报错", () => {
    const root = tempDir();
    const raw = path.join(root, "raw");
    fs.mkdirSync(path.join(raw, "whatever"), { recursive: true });
    expect(() => normalizeSkillDir(raw, path.join(root, "stage", "skill"))).toThrow("不是 TodooCard_Skills");
  });
});

describe("installSkill", () => {
  it("下载 → 解压 → 原子替换 → 写 meta", async () => {
    const stateDir = tempDir();
    const meta = await installSkill({
      stateDir,
      sourceUrl: DEFAULT_SOURCE_URL,
      expectedSha256: null,
      downloader: async (_url, dest) => {
        fs.writeFileSync(dest, "fake-archive");
      },
      extractor: async (_archive, rawDir) => {
        writeSkill(path.join(rawDir, `TodooCard_Skills-${PINNED_COMMIT.slice(0, 7)}`));
      },
    });
    expect(meta.ref).toBe(`TodooCard_Skills-${PINNED_COMMIT.slice(0, 7)}`);
    expect(meta.sha256).toHaveLength(64);
    expect(fs.existsSync(path.join(stateDir, "skill", "todoocard-skills", "scripts", "prepare_and_send.sh"))).toBe(true);
    expect(readSkillMeta(stateDir)).toMatchObject({ sourceUrl: DEFAULT_SOURCE_URL, ref: meta.ref });
    expect(detectSkill(stateDir).installed).toBe(true);
  });

  it("镜像前缀只改变下载地址，安装前仍校验固定摘要", async () => {
    const stateDir = tempDir();
    let seenUrl = "";
    await expect(installSkill({
      stateDir,
      sourceUrl: DEFAULT_SOURCE_URL,
      mirror: "https://gh-proxy.com/",
      downloader: async (url, dest) => {
        seenUrl = url;
        fs.writeFileSync(dest, "fake-archive");
      },
    })).rejects.toThrow("SHA-256 校验失败");
    expect(seenUrl).toBe(`https://gh-proxy.com/${sourceToArchiveUrl(DEFAULT_SOURCE_URL)}`);
    expect(detectSkill(stateDir).installed).toBe(false);
  });

  it("错误摘要会被拒绝且不写 meta", async () => {
    const stateDir = tempDir();
    let extracted = false;
    await expect(installSkill({
      stateDir,
      sourceUrl: DEFAULT_SOURCE_URL,
      downloader: async (_url, dest) => {
        fs.writeFileSync(dest, "fake-archive");
      },
      extractor: async (_archive, rawDir) => {
        extracted = true;
        writeSkill(path.join(rawDir, "TodooCard_Skills-x"));
      },
    })).rejects.toThrow("SHA-256 校验失败");
    expect(extracted).toBe(false);
    expect(readSkillMeta(stateDir)).toBeNull();
  });

  it("自定义来源不做固定摘要校验，只记录实际摘要", async () => {
    const stateDir = tempDir();
    const meta = await installSkill({
      stateDir,
      sourceUrl: "https://github.com/a/b",
      downloader: async (_url, dest) => {
        fs.writeFileSync(dest, "fake-archive");
      },
      extractor: async (_archive, rawDir) => {
        writeSkill(path.join(rawDir, "b-main"));
      },
    });
    expect(meta.sha256).toHaveLength(64);
    expect(meta.ref).toBe("b-main");
  });

  it("下载失败时保留旧 Skill", async () => {
    const stateDir = tempDir();
    const oldScript = path.join(stateDir, "skill", "todoocard-skills", "scripts", "prepare_and_send.sh");
    fs.mkdirSync(path.dirname(oldScript), { recursive: true });
    fs.writeFileSync(oldScript, "old", "utf8");

    await expect(installSkill({
      stateDir,
      sourceUrl: DEFAULT_SOURCE_URL,
      downloader: async () => { throw new Error("network down"); },
    })).rejects.toThrow("network down");

    expect(fs.readFileSync(oldScript, "utf8")).toBe("old");
    expect(detectSkill(stateDir).installed).toBe(true);
  });
});
