<script lang="ts">
  import { createEventDispatcher } from "svelte";
  export let status: string = "not-installed";
  export let running: boolean = false;
  export let mode: string = "";
  export let launch: string = "auto";
  export let port: number = 8199;
  export let coreDir: string = "";
  export let log: string = "";
  export let isDarwin: boolean = true;
  const dispatch = createEventDispatcher();
  const onPortChange = (e: Event) => dispatch("port", parseInt((e.currentTarget as HTMLInputElement).value, 10));
</script>

<div class="tc-panel">
  <div class="tc-row">状态：{running ? `运行中（${mode}）` : status}</div>
  <div class="tc-row">
    <button class="b3-button b3-button--outline" on:click={() => dispatch("install")}>安装/更新</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("start")} disabled={running}>启动</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("stop")} disabled={!running}>停止</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("recheck")}>重新检测</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("openweb")} disabled={!running}>打开传图界面</button>
  </div>
  <div class="tc-row">
    启动方式：
    <select bind:value={launch} on:change={() => dispatch("launch", launch)}>
      <option value="auto">自动 ①→②→④</option>
      <option value="direct">仅 ① 直接</option>
      {#if isDarwin}<option value="disclaim">仅 ② disclaim</option>{/if}
      {#if isDarwin}<option value="terminal">仅 ④ Terminal</option>{/if}
    </select>
  </div>
  <div class="tc-row">端口：
    <input class="b3-text-field" type="number" min="1" max="65535" style="width:90px"
      value={port}
      on:change={onPortChange} />
    <span class="tc-hint">核心 Web UI 端口（默认 8199；被占用时可改）</span>
  </div>
  <div class="tc-row">核心目录：<code>{coreDir}</code>
    <button class="b3-button b3-button--text" on:click={() => dispatch("opendir")}>打开</button>
    <button class="b3-button b3-button--text" on:click={() => dispatch("changedir")}>更改</button>
  </div>
  <pre class="tc-log">{log}</pre>
</div>

<style>
  .tc-panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .tc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; }
  .tc-log { max-height: 220px; overflow: auto; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 8px; font-size: 12px; white-space: pre-wrap; }
  .tc-hint { color: var(--b3-theme-on-surface); opacity: 0.6; font-size: 12px; }
</style>
