# desktop-web

GT Office 的 Web UI / Tauri 前端工程。

## 目录约定

- `src/`: 前端源码
- `scripts/`: 本地辅助脚本
- `docs/legacy/`: 历史修复说明、验证记录、对照资产

## 常用命令

```bash
npm install
npm run dev:tauri
npm run build:tauri
npx tsc -p tsconfig.app.json --noEmit
```

## WSL 启动

在 `apps/desktop-web` 目录下：

```bash
bash ./scripts/run-wsl.sh
```

Windows 下：

```powershell
.\scripts\start-wsl.bat
```

## 说明

- 根目录只保留构建配置、入口文件和标准说明。
- 历史样式修复记录与临时验证材料已迁入 `docs/legacy/`。
