# 各平台发帖文案

---

## 📕 掘金（技术博客全文）

直接使用 `docs/blog/2026-04-18-why-you-need-an-agent-workspace.md` 的内容发布。

标题选项：
- 《同时开 5 个终端跑 AI Agent？你需要一个工作台》
- 《2026 年了，你的 AI Agent 还在终端里"裸奔"？》
- 《开源项目推荐：把 Claude Code、Codex、Gemini CLI 收编到一个桌面 App》

标签：AI、Rust、Tauri、开源项目、Claude Code

---

## 📗 知乎（技术回答 + 文章）

### 回答问题（找到相关问题回答）：

搜索关键词："AI Agent"、"Claude Code"、"多Agent协同"、"AI编程工具"

**回答模板：**

> 我最近做了一个开源项目专门解决这个问题——**GT Office**。
>
> 核心痛点就是：用 Claude Code / Codex / Gemini CLI 时，终端 Tab 切到手酸，Agent 之间不通，关掉就丢状态。
>
> GT Office 把这些 CLI 原生嵌入到一个桌面工作台里：
> - Agent 持久化（关掉不丢状态）
> - Agent 间通信总线（自动派发/协作）
> - 手机端通道（Telegram/微信/飞书监控）
>
> 项目地址：https://github.com/Laplace-bit/GT-Office
>
> 欢迎 Star ⭐ 和试用反馈。

---

## 📙 V2EX（分享创造板块）

**标题：** 开源了一个 AI Agent 工作台——GT Office，把 Claude Code / Codex / Gemini CLI 统一管理

**内容：**

> 各位 V 友好，
>
> 做了一个开源项目叫 **GT Office**，解决一个我自己遇到的痛点：每天开一堆终端 Tab 分别跑 Claude Code、Codex、Gemini CLI，切来切去很容易乱，关掉终端上下文全丢。
>
> GT Office 做了这几件事：
>
> 1. 把 AI CLI 原生嵌入桌面 GUI（不是 API 封装，是真正的 CLI）
> 2. Agent 状态持久化，关掉再开还在
> 3. Agent 之间可以通过内置 gto CLI 自动通信、派发任务
> 4. 支持 Telegram / 微信 / 飞书通道，手机上也能看 Agent 进度
>
> 技术栈：Rust + Tauri v2 + React，< 30MB，跨平台。
>
> 项目地址：https://github.com/Laplace-bit/GT-Office
>
> 现在还是早期（v0.3.1），求 Star ⭐ 和试用反馈！
>
> 如果你也每天和多个 AI Agent 打交道，欢迎来聊聊你的工作流。

---

## 📕 即刻（精简版）

> 开源了一个 AI Agent 工作台📱
>
> 痛点：每天开 N 个终端 Tab 跑 Claude Code / Codex / Gemini CLI，切换到崩溃
>
> 解法：统一桌面 App 管理，Agent 持久化 + 互相通信 + 手机端监控
>
> Rust + Tauri，轻量跨平台
>
> 🏢 GT Office → github.com/Laplace-bit/GT-Office
>
> 求星⭐ 求反馈💬

---

## 🔵 小红书（泛开发者向）

> 标题：程序员福音🔥 一个 App 管理所有 AI Agent！
>
> 每天开 10+ 终端 Tab 切到眼花？😭
> 用 Claude Code 写代码 + Codex 做测试 + Gemini 做审查，全是命令行窗口...
>
> 我做了个开源工具 GT Office 🏢
> ✅ 统一桌面管理所有 AI Agent
> ✅ 关掉不丢状态（持久化工作区）
> ✅ Agent 之间自动协作通信
> ✅ 手机端 Telegram/微信也能监控
>
> Rust 构建，轻量秒开 < 30MB 💨
> 免费开源 → GitHub 搜 GT Office
>
> #AI编程 #开源项目 #ClaudeCode #Rust #程序员效率 #桌面应用