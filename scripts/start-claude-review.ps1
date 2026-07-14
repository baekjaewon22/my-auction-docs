[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Show-LauncherMessage {
  param(
    [string]$Message,
    [string]$Title,
    [string]$Icon = 'Information'
  )
  if ($Quiet) {
    Write-Host "$Title - $Message"
    return
  }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::$Icon
  ) | Out-Null
}

if (!$CheckOnly -and !$Quiet) {
  Add-Type -AssemblyName PresentationFramework
  $approval = [System.Windows.MessageBox]::Show(
    "현재 저장소의 변경 코드와 필요한 문맥을 Anthropic Claude Code로 전송해 읽기 전용 리뷰를 실행합니다.`n`n외부 전송을 승인하시겠습니까?",
    'Claude 코드 리뷰 실행 승인',
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  if ($approval -ne [System.Windows.MessageBoxResult]::Yes) {
    exit 0
  }
}

Push-Location $repoRoot
try {
  if ($CheckOnly) {
    & npm.cmd run ai:review:check
  } else {
    & npm.cmd run ai:review:external
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) {
    $message = if ($CheckOnly) {
      'Codex와 Claude Code의 로컬 연결 준비 상태가 정상입니다.'
    } else {
      "Claude 리뷰가 완료됐습니다.`n결과는 .ai\reviews\latest-claude-review.json에 저장됐습니다.`n다음 Codex 작업에서 자동 확인됩니다."
    }
    Show-LauncherMessage -Message $message -Title 'Claude 코드 리뷰 완료'
  } else {
    Show-LauncherMessage -Message "Claude 리뷰 실행이 실패했습니다. 열린 PowerShell 창의 오류 내용을 확인해주세요. (종료 코드: $exitCode)" -Title 'Claude 코드 리뷰 실패' -Icon 'Error'
  }
  exit $exitCode
} catch {
  Show-LauncherMessage -Message $_.Exception.Message -Title 'Claude 코드 리뷰 실패' -Icon 'Error'
  exit 1
} finally {
  Pop-Location
}
