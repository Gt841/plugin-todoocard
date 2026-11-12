# DEPRECATED — Phase 1 的 git-diff 补丁

这两个补丁**已作废**，不要再应用到 eink fork：

- `force-python.patch`
- `localhost-bind.patch`

原因：它们打在固定 base `b0f2673` 上，而上游 `shidaifufen/todoocard-eink` 已到 v1.0.11，
自行修好了 sender 的 `find_device_by_id` bug 与 `_send_python` 的 `output` 键，并重写了 sender。
旧补丁在新版源码上 `git apply` 失败，且上游 Release 的便携包是 PyInstaller 冻结二进制，根本无法打补丁。

## 现在怎么做

分发模型改为「上游源码 tarball + 版本匹配的薄扩展包」。必要改动由独立仓库
`../todoocard-core-dist/extension/apply.py` 用**锚点断言 + 幂等 + py_compile** 的文本替换注入：

- force-python 门控（`_build_payload` / `_send_blocking` / `_scan`）
- `_pair_python`（检测窗口 → 复用上游 `_pair_bleak` 连接/系统配对）+ 3 处配对门控
- `HOST` 默认 `127.0.0.1` 的 localhost-bind

上游已修的 sender / output-key 修复不再注入；`pick_folders` 的平台分支保持原样。
维护者工作流见 `../todoocard-core-dist/docs/maintainer.md`。

## 保留原因

仅作 Phase 1 历史回溯与 `_pair_python` / force-python 概念来源；后续可删除，但删除前请确认
没有文档或脚本再引用它们。`force-python.patch` 当前工作树里还有一处**未提交的改动**（重生成版本），
按设计文档 §8：**不提交旧式补丁**。
