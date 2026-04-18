# 同时开 5 个终端跑 AI Agent？你需要一个工作台

> 本文首发于掘金，作者：GT Office 团队

## 你的日常是不是这样？

打开电脑，启动工作——

- 一个终端跑 Claude Code 做架构设计
- 一个终端跑 Codex 写代码
- 一个终端跑 Gemini CLI 做代码审查
- 还要开 Git 终端、看日志、搜文件……

**十几个终端 Tab 切来切去**，关掉一个就丢掉一整套上下文。Agent 之间完全不通，想让它俩协作？只能自己手动复制粘贴。

更痛苦的是——**离开电脑就断联了**。出门在外想看 Agent 的执行状态？看不到。

这不应该是 2026 年的开发者日常。

## GT Office：给 AI Agent 一个正式的"工位"

**GT Office** 是一个开源的跨平台桌面应用，专为管理多个 AI Agent 设计。它做的事很简单：

**把散落在终端里的 AI Agent，收编到统一的工作台里。**

就像你不会把所有文件堆在桌面上——你需要一个文件夹系统。GT Office 就是 Agent 的文件夹系统。

## 它具体解决了什么？

### 1. 🔌 原生集成，不是套壳

GT Office 直接嵌入 Claude Code、Codex CLI、Gemini CLI 的官方命令行工具。**不是 API 封装，不是阉割版**——是原汁原味的 CLI，只是多了一层图形化管理。

Agent 做到的事情，在 GT Office 里一样能做到。没有任何能力损失。

### 2. 🏠 工作区持久化

创建一个 Agent，它就活在你的工作区里。关掉应用再打开，Agent 还在，状态还在。

不用每次重新 `cd` 到目录、重新输入上下文、重新启动。**一次创建，持续存在。**

### 3. 🔄 Agent 之间终于能说话了

这是 GT Office 最独特的功能：**Agent-to-Agent 通信总线**。

内置的 `gto` CLI 工具让 Agent 之间可以：
- 派发任务（Agent A 让 Agent B 做事）
- 共享上下文（自动传递执行环境）
- 交接工作（一个 Agent 做完，另一个接着来）

**不用人当中间人，Agent 自己协商协作。**

### 4. 📡 手机上也能监控

GT Office 支持外部 Channel 代理——把 Agent 的执行流推送到：
- **Telegram**
- **微信**
- **飞书**

地铁上用手机看 Agent 进度，随手发一条消息指挥它改方案。**你的办公室，就在口袋里。**

### 5. ⚔️ 自动评审：对抗推理架构

预设 "生成者-评审者" 角色对，让 Agent A 产出、Agent B 审核，自动内部迭代后再交付给你。

**代码还没到你手上，已经过了一轮 Review。**

## 技术栈

如果你是技术人，可能会关心实现：

| 层 | 技术 |
|----|------|
| 后端 | Rust（多个 domain crate：terminal、git、workspace、task...） |
| 前端 | React + Vite + TypeScript |
| 壳 | Tauri v2（Rust ↔ JS 桥接） |
| 通信 | gto CLI（Node.js） |

整个应用 **< 30MB 安装包**，启动秒开，内存占用低。没有 Electron 的臃肿。

## 5 分钟上手

```bash
# 从源码构建（需要 Node.js 20+ 和 Rust）
git clone https://github.com/Laplace-bit/GT-Office.git
cd GT-Office
npm install
npm run dev:tauri
```

或者直接下载预编译版本：[GitHub Releases](https://github.com/Laplace-bit/GT-Office/releases)

支持 **macOS**、**Windows**、**Linux** 三平台。

## 为什么开源？

AI Agent 协同是一个全新的领域，标准还没建立。我们相信**开源**是最好的方式：

- 让开发者可以自由定制自己的 Agent 工作流
- 让社区一起定义 Agent 间通信的协议
- 让好想法不被商业闭源限制

**Apache 2.0 许可证**，随便用，随便改。

## 接下来做什么？

GT Office 还在早期（v0.3.x），路线图上有：

- 🔜 代码签名 & 公证（告别 Gatekeeper 阻拦）
- 🔜 插件系统（自定义工具适配器）
- 🔜 SSH 远程工作区
- 🔜 Homebrew / Winget 一键安装

---

**如果你每天和 AI Agent 打交道，GT Office 值得试一试。**

👉 GitHub: [Laplace-bit/GT-Office](https://github.com/Laplace-bit/GT-Office)

⭐ 给个 Star，帮助更多人发现这个项目。

💬 有问题？开 [Issue](https://github.com/Laplace-bit/GT-Office/issues) 或 [Discussion](https://github.com/Laplace-bit/GT-Office/discussions)。

---

*GT Office — 让每一个 AI Agent 都有自己的工位。*