[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $PSScriptRoot 'start-claude-review.ps1'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Claude 리뷰 실행.lnk'
$powerShellPath = Join-Path $PSHOME 'powershell.exe'

if (!(Test-Path -LiteralPath $powerShellPath)) {
  $powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = '현재 저장소 변경사항을 Claude Code로 읽기 전용 리뷰합니다.'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,71"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
