# GT Office Demo GIF 录制指南

## 前置条件

1. 启动应用：`cd /Users/dzlin/work/GT-Office && npm run dev:tauri`
2. 安装录制工具：`brew install ffmpeg` （如未安装）

## 录制方式（推荐）

### 方式一：macOS 屏幕录制 + 转 GIF

1. 用 QuickTime 录制屏幕（或 `Cmd+Shift+5` 选区域录制）
2. 保存为 .mov
3. 转换为 GIF：

```bash
# 高质量 GIF（推荐）
ffmpeg -i demo.mov -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 docs/assets/demo.gif

# 压缩版（更小文件）
ffmpeg -i demo.mov -vf "fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=palette=max_colors=128[p];[s1][p]paletteuse=dither=bayer" -loop 0 docs/assets/demo-compressed.gif
```

### 方式二：用 terminalizer 录制终端演示

```bash
npm install -g terminalizer
terminalizer record demo
terminalizer render demo -o docs/assets/demo.gif
```

## 演示脚本（~60秒）

### 场景 1：启动 & 工作区概览（0-10s）
- 启动 GT Office
- 展示工作区列表
- 点击进入一个工作区

### 场景 2：创建 & 启动 Agent（10-25s）
- 点击"New Agent"
- 选择 Claude Code
- 输入任务 → Agent 开始执行
- 展示终端输出实时滚动

### 场景 3：Agent 间通信（25-40s）
- 展示 gto CLI 发送任务
- 另一个 Agent 收到并开始处理

### 场景 4：外部通道（40-50s）
- 展示 Channel 配置
- 手机端收到消息的截图切换

### 场景 5：Git & 文件操作（50-60s）
- Git 面板：查看 diff、commit
- 文件浏览器：打开文件、编辑

## 质量要求

- 分辨率：800px 宽（适配 GitHub README）
- 帧率：15fps（流畅 + 文件小）
- 时长：30-60秒
- 文件大小：< 5MB
- 循环播放：`-loop 0`

## 录制后

把 demo.gif 放到 `docs/assets/demo.gif`，然后在 README.md 的 Quick Start 区域上方加：

```markdown
![GT Office Demo](docs/assets/demo.gif)
```