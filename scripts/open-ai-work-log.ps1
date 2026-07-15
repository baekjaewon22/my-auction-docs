[CmdletBinding()]
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logRoot = Join-Path $repoRoot '.ai\collaboration'
$reviewPath = Join-Path $repoRoot '.ai\reviews\latest-claude-review.md'

function Protect-LogText {
  param([AllowNull()][string]$Text)

  if ([string]::IsNullOrEmpty($Text)) { return '' }

  $protected = $Text
  $patterns = @(
    '(?im)(authorization\s*:\s*bearer\s+)[^\s]+',
    '(?im)((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+',
    '(?i)\b(?:sk|pk)-[a-z0-9_-]{16,}\b'
  )
  foreach ($pattern in $patterns) {
    $protected = [regex]::Replace($protected, $pattern, '${1}[REDACTED]')
  }
  return $protected
}

function Get-LatestClaudeReview {
  if (Test-Path -LiteralPath $reviewPath) {
    return Get-Content -LiteralPath $reviewPath -Raw -Encoding UTF8
  }
  return '저장된 Claude 리뷰가 없습니다.'
}

function Get-GitHead {
  try {
    $head = (& git -C $repoRoot rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0) { return ($head | Select-Object -First 1).Trim() }
  } catch { }
  return ''
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if ($CheckOnly) {
  Write-Host "AI work log is ready: $logRoot"
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'AI 작업 기록'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1080, 820)
$form.MinimumSize = New-Object System.Drawing.Size(900, 700)
$form.Font = New-Object System.Drawing.Font('Malgun Gothic', 10)
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 252)

$header = New-Object System.Windows.Forms.Label
$header.Text = 'AI 작업 기록'
$header.Font = New-Object System.Drawing.Font('Malgun Gothic', 19, [System.Drawing.FontStyle]::Bold)
$header.ForeColor = [System.Drawing.Color]::FromArgb(25, 39, 69)
$header.AutoSize = $true
$header.Location = New-Object System.Drawing.Point(24, 18)
$form.Controls.Add($header)

$description = New-Object System.Windows.Forms.Label
$description.Text = 'Codex 요청과 결과, Claude 리뷰를 이 PC에만 저장합니다. 비밀번호와 토큰 형태의 문구는 저장 시 자동 마스킹됩니다.'
$description.AutoSize = $true
$description.ForeColor = [System.Drawing.Color]::FromArgb(82, 94, 116)
$description.Location = New-Object System.Drawing.Point(28, 58)
$form.Controls.Add($description)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = '작업 제목'
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(28, 94)
$form.Controls.Add($titleLabel)

$titleBox = New-Object System.Windows.Forms.TextBox
$titleBox.Location = New-Object System.Drawing.Point(108, 90)
$titleBox.Size = New-Object System.Drawing.Size(920, 28)
$titleBox.Anchor = 'Top, Left, Right'
$form.Controls.Add($titleBox)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(24, 130)
$tabs.Size = New-Object System.Drawing.Size(1004, 560)
$tabs.Anchor = 'Top, Bottom, Left, Right'
$form.Controls.Add($tabs)

function Add-EditorTab {
  param([string]$Name, [string]$Hint, [bool]$ReadOnly = $false)

  $tab = New-Object System.Windows.Forms.TabPage
  $tab.Text = $Name
  $tab.BackColor = [System.Drawing.Color]::White

  $hintLabel = New-Object System.Windows.Forms.Label
  $hintLabel.Text = $Hint
  $hintLabel.AutoSize = $true
  $hintLabel.ForeColor = [System.Drawing.Color]::FromArgb(96, 108, 130)
  $hintLabel.Location = New-Object System.Drawing.Point(14, 14)
  [void]$tab.Controls.Add($hintLabel)

  $editor = New-Object System.Windows.Forms.TextBox
  $editor.Multiline = $true
  $editor.ScrollBars = 'Both'
  $editor.AcceptsReturn = $true
  $editor.AcceptsTab = $true
  $editor.WordWrap = $true
  $editor.ReadOnly = $ReadOnly
  $editor.Font = New-Object System.Drawing.Font('Malgun Gothic', 10)
  $editor.Location = New-Object System.Drawing.Point(14, 42)
  $editor.Size = New-Object System.Drawing.Size(965, 465)
  $editor.Anchor = 'Top, Bottom, Left, Right'
  [void]$tab.Controls.Add($editor)
  [void]$tabs.TabPages.Add($tab)
  return $editor
}

$promptBox = Add-EditorTab -Name 'Codex 요청' -Hint 'Codex에 전달한 작업 요청을 붙여 넣으세요.'
$resultBox = Add-EditorTab -Name 'Codex 결과' -Hint '변경 내용, 테스트 결과 또는 Codex 최종 답변을 기록하세요.'
$claudeBox = Add-EditorTab -Name 'Claude 답변' -Hint '가장 최근 Claude 리뷰 파일을 자동으로 불러옵니다. 필요한 경우 직접 수정할 수 있습니다.'
$claudeBox.ReadOnly = $false
$claudeBox.Text = Get-LatestClaudeReview

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "로컬 저장 위치: $logRoot"
$statusLabel.AutoSize = $true
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(82, 94, 116)
$statusLabel.Location = New-Object System.Drawing.Point(28, 704)
$statusLabel.Anchor = 'Bottom, Left'
$form.Controls.Add($statusLabel)

function New-ActionButton {
  param([string]$Text, [int]$X, [int]$Width, [System.Drawing.Color]$Color)
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Size = New-Object System.Drawing.Size($Width, 40)
  $button.Location = New-Object System.Drawing.Point($X, 730)
  $button.Anchor = 'Bottom, Left'
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  $button.BackColor = $Color
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Cursor = [System.Windows.Forms.Cursors]::Hand
  $form.Controls.Add($button)
  return $button
}

$saveButton = New-ActionButton -Text '작업 기록 저장' -X 24 -Width 160 -Color ([System.Drawing.Color]::FromArgb(39, 91, 212))
$reloadButton = New-ActionButton -Text 'Claude 답변 새로고침' -X 194 -Width 190 -Color ([System.Drawing.Color]::FromArgb(76, 87, 111))
$latestButton = New-ActionButton -Text '최근 기록 열기' -X 394 -Width 150 -Color ([System.Drawing.Color]::FromArgb(76, 87, 111))
$folderButton = New-ActionButton -Text '저장 폴더 열기' -X 554 -Width 150 -Color ([System.Drawing.Color]::FromArgb(76, 87, 111))

$reloadButton.Add_Click({
  $claudeBox.Text = Get-LatestClaudeReview
  $statusLabel.Text = '최신 Claude 리뷰를 다시 불러왔습니다.'
})

$folderButton.Add_Click({ Start-Process explorer.exe -ArgumentList $logRoot })

$latestButton.Add_Click({
  $latest = Get-ChildItem -LiteralPath $logRoot -Filter '*.md' -File -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) {
    Start-Process notepad.exe -ArgumentList $latest.FullName
  } else {
    [System.Windows.Forms.MessageBox]::Show('아직 저장된 작업 기록이 없습니다.', 'AI 작업 기록') | Out-Null
  }
})

$saveButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($titleBox.Text)) {
    [System.Windows.Forms.MessageBox]::Show('작업 제목을 입력해 주세요.', 'AI 작업 기록') | Out-Null
    $titleBox.Focus()
    return
  }

  $now = Get-Date
  $taskId = $now.ToString('yyyyMMdd-HHmmss')
  $monthPath = Join-Path $logRoot $now.ToString('yyyy\MM')
  New-Item -ItemType Directory -Path $monthPath -Force | Out-Null

  $safeTitle = Protect-LogText $titleBox.Text.Trim()
  $prompt = Protect-LogText $promptBox.Text
  $result = Protect-LogText $resultBox.Text
  $claude = Protect-LogText $claudeBox.Text
  $gitHead = Get-GitHead

  $record = [ordered]@{
    task_id = $taskId
    created_at = $now.ToString('o')
    title = $safeTitle
    repository = $repoRoot
    git_head = $gitHead
    codex_prompt = $prompt
    codex_result = $result
    claude_response = $claude
    storage = 'local-only'
  }

  $jsonPath = Join-Path $monthPath "$taskId.json"
  $mdPath = Join-Path $monthPath "$taskId.md"
  $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

  $markdown = @"
# $safeTitle

- 작업 ID: ``$taskId``
- 저장 시각: $($now.ToString('yyyy-MM-dd HH:mm:ss zzz'))
- Git 커밋: ``$gitHead``
- 저장 방식: 로컬 전용

## Codex 요청

$prompt

## Codex 결과

$result

## Claude 답변

$claude
"@
  Set-Content -LiteralPath $mdPath -Value $markdown -Encoding UTF8
  Copy-Item -LiteralPath $mdPath -Destination (Join-Path $logRoot 'latest.md') -Force

  $statusLabel.Text = "저장 완료: $mdPath"
  $open = [System.Windows.Forms.MessageBox]::Show(
    "작업 기록을 로컬에 저장했습니다.`n`n저장된 기록을 지금 여시겠습니까?",
    'AI 작업 기록',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
  )
  if ($open -eq [System.Windows.Forms.DialogResult]::Yes) {
    Start-Process notepad.exe -ArgumentList $mdPath
  }
})

[void]$form.ShowDialog()
