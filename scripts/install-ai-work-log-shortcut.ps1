[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $PSScriptRoot 'open-ai-work-log.ps1'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'AI 작업 기록.lnk'
$powerShellPath = Join-Path $PSHOME 'powershell.exe'

if (!(Test-Path -LiteralPath $powerShellPath)) {
  $powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = 'Codex 요청과 Claude 답변을 로컬에 저장합니다.'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,71"
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
