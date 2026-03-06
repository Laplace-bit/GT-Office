#!/bin/bash
# 测试环境变量对 Agent 输出的影响

set -e

echo "=== Agent 输出测试 ==="
echo ""

# 测试命令
TEST_COMMAND="写一首短诗"

# 输出目录
OUTPUT_DIR="/tmp/agent-output-test"
mkdir -p "$OUTPUT_DIR"

echo "测试命令: $TEST_COMMAND"
echo "输出目录: $OUTPUT_DIR"
echo ""

# 测试 1: 默认输出（带 TUI）
echo "--- 测试 1: 默认输出 (带 TUI) ---"
if command -v claude &> /dev/null; then
    echo "$TEST_COMMAND" | timeout 30 claude > "$OUTPUT_DIR/claude-default.txt" 2>&1 || true
    echo "✓ Claude Code 默认输出已保存"
    echo "  行数: $(wc -l < "$OUTPUT_DIR/claude-default.txt")"
    echo "  大小: $(wc -c < "$OUTPUT_DIR/claude-default.txt") bytes"
else
    echo "⚠ Claude Code 未安装"
fi
echo ""

# 测试 2: 禁用 TUI
echo "--- 测试 2: 禁用 TUI (NO_COLOR + TERM=dumb) ---"
if command -v claude &> /dev/null; then
    echo "$TEST_COMMAND" | NO_COLOR=1 TERM=dumb timeout 30 claude > "$OUTPUT_DIR/claude-notui.txt" 2>&1 || true
    echo "✓ Claude Code 无 TUI 输出已保存"
    echo "  行数: $(wc -l < "$OUTPUT_DIR/claude-notui.txt")"
    echo "  大小: $(wc -c < "$OUTPUT_DIR/claude-notui.txt") bytes"
else
    echo "⚠ Claude Code 未安装"
fi
echo ""

# 测试 3: CI 模式
echo "--- 测试 3: CI 模式 (CI=true) ---"
if command -v claude &> /dev/null; then
    echo "$TEST_COMMAND" | NO_COLOR=1 TERM=dumb CI=true timeout 30 claude > "$OUTPUT_DIR/claude-ci.txt" 2>&1 || true
    echo "✓ Claude Code CI 模式输出已保存"
    echo "  行数: $(wc -l < "$OUTPUT_DIR/claude-ci.txt")"
    echo "  大小: $(wc -c < "$OUTPUT_DIR/claude-ci.txt") bytes"
else
    echo "⚠ Claude Code 未安装"
fi
echo ""

# 测试 Codex CLI（如果可用）
if command -v codex &> /dev/null; then
    echo "--- 测试 4: Codex CLI 默认输出 ---"
    echo "$TEST_COMMAND" | timeout 30 codex > "$OUTPUT_DIR/codex-default.txt" 2>&1 || true
    echo "✓ Codex CLI 默认输出已保存"
    echo "  行数: $(wc -l < "$OUTPUT_DIR/codex-default.txt")"
    echo ""

    echo "--- 测试 5: Codex CLI 无 TUI ---"
    echo "$TEST_COMMAND" | NO_COLOR=1 TERM=dumb timeout 30 codex > "$OUTPUT_DIR/codex-notui.txt" 2>&1 || true
    echo "✓ Codex CLI 无 TUI 输出已保存"
    echo "  行数: $(wc -l < "$OUTPUT_DIR/codex-notui.txt")"
    echo ""
fi

# 分析结果
echo "=== 分析结果 ==="
echo ""

if [ -f "$OUTPUT_DIR/claude-default.txt" ] && [ -f "$OUTPUT_DIR/claude-notui.txt" ]; then
    DEFAULT_LINES=$(wc -l < "$OUTPUT_DIR/claude-default.txt")
    NOTUI_LINES=$(wc -l < "$OUTPUT_DIR/claude-notui.txt")

    echo "Claude Code 行数对比:"
    echo "  默认: $DEFAULT_LINES 行"
    echo "  无TUI: $NOTUI_LINES 行"

    if [ "$NOTUI_LINES" -lt "$DEFAULT_LINES" ]; then
        REDUCTION=$((100 * (DEFAULT_LINES - NOTUI_LINES) / DEFAULT_LINES))
        echo "  减少: $REDUCTION%"

        if [ "$REDUCTION" -gt 70 ]; then
            echo "  ✅ 效果显著！建议使用环境变量方案"
        elif [ "$REDUCTION" -gt 30 ]; then
            echo "  ⚠️  效果一般，建议实施双通道架构"
        else
            echo "  ❌ 效果不佳，需要立即重构"
        fi
    fi
    echo ""

    echo "框线字符统计:"
    echo "  默认: $(grep -o '[╭╮╰╯│─┌┐└┘├┤┬┴┼]' "$OUTPUT_DIR/claude-default.txt" | wc -l) 个"
    echo "  无TUI: $(grep -o '[╭╮╰╯│─┌┐└┘├┤┬┴┼]' "$OUTPUT_DIR/claude-notui.txt" | wc -l) 个"
    echo ""

    echo "状态行统计 (包含 '·' 的行):"
    echo "  默认: $(grep '·' "$OUTPUT_DIR/claude-default.txt" | wc -l) 行"
    echo "  无TUI: $(grep '·' "$OUTPUT_DIR/claude-notui.txt" | wc -l) 行"
    echo ""
fi

echo "=== 查看输出文件 ==="
echo "使用以下命令查看详细输出:"
echo "  cat $OUTPUT_DIR/claude-default.txt"
echo "  cat $OUTPUT_DIR/claude-notui.txt"
echo "  diff $OUTPUT_DIR/claude-default.txt $OUTPUT_DIR/claude-notui.txt"
echo ""

echo "=== 测试完成 ==="
