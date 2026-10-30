$ErrorActionPreference = 'Stop'

$configPath = Join-Path $env:USERPROFILE '.codex\config.toml'
$wrapperPath = Join-Path $PSScriptRoot 'codex-notify.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Codex 설정 파일을 찾을 수 없습니다: $configPath"
}

$content = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
if ($content -match [regex]::Escape($wrapperPath)) {
  Write-Host 'Codex 대화 자동 동기화 알림이 이미 설정되어 있습니다.'
  exit 0
}

$notifyMatch = [regex]::Match($content, '(?m)^notify\s*=\s*\[(?<items>[^\r\n]*)\]\s*$')
if (-not $notifyMatch.Success) {
  throw '기존 Codex notify 설정을 찾을 수 없습니다. 기존 알림을 보존하기 위해 자동 변경을 중단했습니다.'
}

function Escape-TomlString([string]$value) {
  return $value.Replace('\', '\\').Replace('"', '\"')
}

$existingItems = [regex]::Matches($notifyMatch.Groups['items'].Value, '"(?<value>(?:\\.|[^"\\])*)"') |
  ForEach-Object { $_.Groups['value'].Value.Replace('\\', '\').Replace('\"', '"') }
if ($existingItems.Count -eq 0) {
  throw '기존 Codex notify 명령을 해석할 수 없습니다.'
}

$newItems = @($nodePath, $wrapperPath) + @($existingItems) + @('--')
$newLine = 'notify = [ ' + (($newItems | ForEach-Object { '"' + (Escape-TomlString $_) + '"' }) -join ', ') + ' ]'
$backupPath = "$configPath.before-my-docs-sync"
Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
$updated = $content.Remove($notifyMatch.Index, $notifyMatch.Length).Insert($notifyMatch.Index, $newLine)
[IO.File]::WriteAllText($configPath, $updated, [Text.UTF8Encoding]::new($false))

Write-Host 'Codex 턴 종료 자동 동기화를 설정했습니다.'
Write-Host "기존 설정 백업: $backupPath"
