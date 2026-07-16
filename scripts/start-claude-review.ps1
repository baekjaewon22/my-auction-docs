[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-LauncherMessage {
  param(
    [string]$Message,
    [string]$Title,
    [string]$Icon = 'Information'
  )
  if ($Quiet) {
    Write-Host "$Title - $Message"
    return [System.Windows.Forms.DialogResult]::OK
  }

  $owner = New-Object System.Windows.Forms.Form
  $owner.StartPosition = 'CenterScreen'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.ShowInTaskbar = $false
  $owner.TopMost = $true
  $owner.Opacity = 0
  $owner.Show()
  $owner.Activate()
  try {
    $messageIcon = [System.Windows.Forms.MessageBoxIcon]::$Icon
    return [System.Windows.Forms.MessageBox]::Show(
      $owner,
      $Message,
      $Title,
      [System.Windows.Forms.MessageBoxButtons]::OK,
      $messageIcon
    )
  } finally {
    $owner.Close()
    $owner.Dispose()
  }
}

function Confirm-ExternalReview {
  if ($Quiet) { return $true }

  $owner = New-Object System.Windows.Forms.Form
  $owner.StartPosition = 'CenterScreen'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.ShowInTaskbar = $false
  $owner.TopMost = $true
  $owner.Opacity = 0
  $owner.Show()
  $owner.Activate()
  try {
    $answer = [System.Windows.Forms.MessageBox]::Show(
      $owner,
      "현재 저장소의 변경 코드와 필요한 문맥을 Anthropic Claude Code로 전송해 읽기 전용 리뷰를 실행합니다.`n`n외부 전송을 승인하시겠습니까?",
      'Claude 코드 리뷰 실행 승인',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning,
      [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
  } finally {
    $owner.Close()
    $owner.Dispose()
  }
}

if (!$CheckOnly -and !$Quiet) {
  if (!(Confirm-ExternalReview)) {
    exit 0
  }
}

Push-Location $repoRoot
try {
  $Host.UI.RawUI.WindowTitle = 'Claude 코드 리뷰 실행 중'
  Write-Host 'Claude 코드 리뷰를 시작합니다. 완료될 때까지 이 창을 닫지 마세요.' -ForegroundColor Cyan
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
    [void](Show-LauncherMessage -Message $message -Title 'Claude 코드 리뷰 완료')
  } else {
    [void](Show-LauncherMessage -Message "Claude 리뷰 실행이 실패했습니다. PowerShell 창의 오류 내용을 확인해주세요. (종료 코드: $exitCode)" -Title 'Claude 코드 리뷰 실패' -Icon 'Error')
  }
  exit $exitCode
} catch {
  [void](Show-LauncherMessage -Message $_.Exception.Message -Title 'Claude 코드 리뷰 실패' -Icon 'Error')
  exit 1
} finally {
  Pop-Location
}
