#!/bin/bash

# WSL环境启动脚本
# 使用方法: bash run-wsl.sh

set -e

echo "🚀 启动 desktop-web 开发服务器（WSL环境）"
echo "================================================"

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未检测到 Node.js"
    echo "请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js 版本: $(node -v)"
echo "✓ npm 版本: $(npm -v)"
echo ""

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    echo "✓ 依赖安装完成"
    echo ""
fi

# 启动开发服务器
echo "🎨 启动开发服务器..."
echo "================================================"
echo ""
echo "样式优化内容："
echo "  ✅ 主题感知的输入框和卡片背景"
echo "  ✅ 深色/浅色主题完美适配"
echo "  ✅ 流畅的微动效和过渡效果"
echo "  ✅ 苹果简洁高级风格"
echo ""
echo "测试要点："
echo "  1. 切换主题检查对比度"
echo "  2. hover按钮查看抬升效果"
echo "  3. focus输入框查看发光效果"
echo "  4. 确认所有交互都有流畅反馈"
echo ""
echo "================================================"
echo ""

npm run dev
