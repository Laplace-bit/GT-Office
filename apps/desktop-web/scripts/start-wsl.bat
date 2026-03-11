@echo off
REM Windows批处理脚本 - 在WSL中启动desktop-web开发服务器

echo.
echo ========================================
echo    启动 desktop-web 在 WSL 环境
echo ========================================
echo.

REM 检查WSL是否安装
wsl --version >nul 2>&1
if errorlevel 1 (
    echo [错误] WSL未安装或未启用
    echo 请参考: https://learn.microsoft.com/zh-cn/windows/wsl/install
    pause
    exit /b 1
)

echo [信息] WSL环境检测成功
echo.

REM 切换到项目目录并运行启动脚本
echo [信息] 正在启动开发服务器...
echo.

wsl bash -c "cd /mnt/c/project/vbCode/apps/desktop-web && bash ./scripts/run-wsl.sh"

REM 如果服务器停止
echo.
echo [信息] 开发服务器已停止
pause
