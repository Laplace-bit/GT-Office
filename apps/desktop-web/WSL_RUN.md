# GT Office WSL 环境运行指南

## 前置条件

确保已安装：
- WSL 2
- Node.js (建议 v18+)
- npm 或 pnpm

## 运行步骤

### 1. 在WSL中打开项目目录

```bash
# 从Windows路径访问（推荐）
cd /mnt/c/project/vbCode/apps/desktop-web

# 或者如果项目已在WSL文件系统中
cd ~/project/vbCode/apps/desktop-web
```

### 2. 安装依赖（如果需要）

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 访问应用

开发服务器启动后，在浏览器中访问显示的URL（通常是 `http://localhost:5173`）

## 验证样式优化

启动后，请验证以下优化效果：

### 主题切换测试
1. 打开设置（Settings）
2. 切换主题在 Light 和 Graphite Dark 之间
3. 检查输入框、下拉框、卡片的背景色是否正确适配

### 交互动效测试
1. **按钮hover** - 应该有轻微抬升效果
2. **按钮点击** - 应该有缩放反馈
3. **输入框focus** - 应该有发光边框和轻微抬升
4. **卡片hover** - 应该有阴影加深和轻微抬升

### 对比度检查
- **浅色主题**: 输入框应该是白色/浅灰色背景
- **深色主题**: 输入框应该是深灰色背景（**不是**白色）

## 性能检查

优化后的动效不应影响性能：
- 使用了硬件加速的transform
- 添加了 `will-change` 优化
- 使用了 `backface-visibility: hidden` 防止闪烁
- 支持 `prefers-reduced-motion` 无障碍设置

## 故障排除

### 如果遇到端口占用

```bash
# 指定不同端口
npm run dev -- --port 5174
```

### 如果样式未生效

```bash
# 清除缓存并重新构建
rm -rf node_modules/.vite
npm run dev
```

### 如果WSL文件系统较慢

建议将项目放在WSL原生文件系统中而非 `/mnt/c/` 路径：

```bash
# 复制到WSL文件系统
cp -r /mnt/c/project/vbCode ~/vbCode
cd ~/vbCode/apps/desktop-web
npm install
npm run dev
```

## 主要改进文件

已优化的文件：
- ✅ `src/index.css` - 核心CSS变量和动效系统
- ✅ `src/shell/layout/shell-layout.css` - 15处硬编码背景已替换
- ✅ `src/shell/layout/TopControlBar.tsx` - 增强的交互动效
- ✅ `tailwind.config.js` - 扩展的动画配置

## 注意事项

1. **主题变量自动适配** - 所有组件现在会根据主题自动调整背景色
2. **动效性能优化** - 使用CSS transform而非margin/padding
3. **无障碍支持** - 自动检测并尊重用户的减少动效偏好
