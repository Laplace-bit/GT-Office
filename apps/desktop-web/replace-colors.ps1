# 系统性替换shell-layout.css中的硬编码颜色值
$filePath = "c:\project\vbCode\apps\desktop-web\src\shell\layout\shell-layout.css"
$content = Get-Content $filePath -Raw

# 定义替换映射
$replacements = @{
    'rgb(255 255 255 / 95%)' = 'rgb(255 255 255 / 95%)' # 保持纯白色文本
    'rgb(255 255 255 / 90%)' = 'var(--vb-input-bg)'
    'rgb(255 255 255 / 92%)' = 'var(--vb-input-bg)'
    'rgb(255 255 255 / 84%)' = 'var(--vb-card-hover-bg)'
    'rgb(255 255 255 / 80%)' = 'var(--vb-card-hover-bg)'
    'rgb(255 255 255 / 78%)' = 'var(--vb-card-bg)'
    'rgb(255 255 255 / 72%)' = 'var(--vb-card-bg)'
    'rgb(255 255 255 / 68%)' = 'var(--vb-card-bg)'
    'rgb(255 255 255 / 66%)' = 'var(--vb-card-bg)'
    'rgb(255 255 255 / 64%)' = 'var(--vb-glass-light)'
    'rgb(255 255 255 / 62%)' = 'var(--vb-glass-light)'
    'rgb(255 255 255 / 58%)' = 'var(--vb-glass-light)'
    'rgb(255 255 255 / 55%)' = 'var(--vb-glass-light)'
    'rgb(255 255 255 / 52%)' = 'var(--vb-glass-lighter)'
    'rgb(255 255 255 / 50%)' = 'var(--vb-glass-lighter)'
    'rgb(245 249 253 / 78%)' = 'var(--vb-card-bg)'
    'rgb(210 220 230 / 30%)' = 'rgba(210, 220, 230, 0.3)'
}

# 执行替换
foreach ($old in $replacements.Keys) {
    $new = $replacements[$old]
    $content = $content.Replace($old, $new)
}

# 保存文件
$content | Set-Content $filePath -NoNewline

Write-Host "替换完成！已更新 shell-layout.css"
Write-Host "替换了 $($replacements.Count) 个颜色值"
