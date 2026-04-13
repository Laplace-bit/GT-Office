# 自动版本管理机制设计

## 问题

版本号散落在 10+ 个文件中，全靠手动同步，已出现漂移（Cargo.toml 0.1.8 vs tauri.conf.json 0.1.9）。CHANGELOG.md 停在 v0.1.6，缺少 v0.1.7~v0.1.9 条目。无任何自动化版本工具。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发方式 | 手动 `npm run release` | 人工把控发布节奏 |
| Rust crate 版本 | 跟应用同步 | 当前阶段不需要独立语义化版本 |
| CHANGELOG 生成 | 基于 git log 自动生成 | 无需强制 commit 规范，简单够用 |
| 方案选择 | 纯脚本（零外部依赖） | 符合 docs/07 精简原则，与现有 scripts/release/ 一致 |

## 版本单一来源

根 `package.json` 的 `version` 字段是唯一来源（Source of Truth）。

## 需要同步的文件

| 文件 | 写入位置 | 说明 |
|------|---------|------|
| `package.json` (root) | `version` | 主版本源 |
| `package-lock.json` (root) | `version`, `packages[""].version` | npm lockfile |
| `apps/desktop-tauri/package.json` | `version` | Tauri shell JS 端 |
| `apps/desktop-tauri/src-tauri/tauri.conf.json` | `version` | Tauri 配置 |
| `apps/desktop-tauri/src-tauri/Cargo.toml` | `package.version` | Tauri Rust 端 |
| `Cargo.toml` (root workspace) | `workspace.package.version` | 新增此字段，统一管理 crate 版本 |
| `crates/*/Cargo.toml` (18 个) | 通过 `version.workspace = true` 继承 | 脚本无需逐个写入 |
| `packages/shared-types/package.json` | `version` | 共享类型包 |
| `tools/gto/package.json` | `version` | CLI 工具 |

**关键改进**：在根 `Cargo.toml` 的 `[workspace.package]` 中新增 `version` 字段。18 个 crate 改为 `version.workspace = true` 继承版本号。脚本只需改根 `Cargo.toml` 的 workspace 版本。

**不动的文件**：
- `apps/desktop-web/package.json` — 前端 SPA，不发布为独立包，保持 `0.0.0`
- `tools/gto-agent-mcp-sidecar/Cargo.toml` — 已排除在 workspace 之外，独立维护

## CHANGELOG 与 Release Notes 生成

1. 执行 `git log --oneline <prevTag>..HEAD` 提取自上个 tag 以来的提交
2. 写入两个位置：
   - `docs/releases/vX.Y.Z.md` — 供 GitHub Release 使用
   - `CHANGELOG.md` — 追加到顶部
3. 生成后暂停提示用户检查和编辑
4. 用户确认后继续

CHANGELOG 格式：

```markdown
## v0.2.0 (2026-04-12)

- abc1234 Fix terminal scroll behavior
- def5678 Add workspace switcher UI
```

简单扁平，基于 commit message。不做 conventional commits 分类。历史缺失条目不自动补全。

## 完整 Release 流程

```
npm run release [patch|minor|major]
```

### 步骤

1. **前置检查**
   - 工作区干净（无未提交改动）
   - 当前在 main 分支
   - 上游与本地同步

2. **版本递增 & 文件写入**
   - 读取当前版本 → 递增
   - 写回所有版本文件
   - Cargo workspace.package.version 写入 + crates 继承

3. **生成 CHANGELOG**
   - git log <prevTag>..HEAD → docs/releases/vX.Y.Z.md
   - 追加到 CHANGELOG.md 顶部

4. **暂停 → 用户审阅**
   - 提示用户 git diff 检查变更
   - 可手动编辑 CHANGELOG / release notes

5. **用户确认后**
   - git add 版本文件 + CHANGELOG + release notes
   - git commit -m "Release v0.2.0"
   - git tag v0.2.0
   - git push && git push --tags

6. **GitHub Actions release.yml 自动接管**构建和发布

### 安全措施

- 前置检查失败立即退出，不修改任何文件
- 暂停审阅确保用户有最终决定权
- `--dry-run` 标志：只打印将要执行的操作，不实际修改
- 用户在步骤 4 中 Ctrl+C 退出，工作区留有未提交的版本文件，可 `git restore` 撤销

### 不做的

- 不自动推送（用户确认后才 push）
- 不在 CI 中自动递增版本
- 不创建 GitHub Release（由 release.yml 处理）

## 实现产物

- `scripts/release/bump.mjs` — 核心脚本，负责版本递增和文件写入
- `package.json` (root) 新增 scripts：`"release": "node scripts/release/bump.mjs"`
- 根 `Cargo.toml` 新增 `workspace.package.version` + 18 个 crate 改为 `version.workspace = true`
- 首次运行前需一次性迁移：将 18 个 crate 的 `version = "0.1.0"` 改为 `version.workspace = true`，并在根 Cargo.toml 设置 `workspace.package.version = "0.1.9"`