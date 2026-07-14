[CmdletBinding()]
param(
  [string]$BaseRef = "HEAD",
  [string]$OutputPath = "",
  [switch]$CheckOnly,
  [switch]$AllowExternalDisclosure,
  [switch]$FailOnFindings
)

$ErrorActionPreference = "Stop"

function Resolve-ClaudeCodeExecutable {
  if ($env:CLAUDE_CODE_EXE -and (Test-Path -LiteralPath $env:CLAUDE_CODE_EXE)) {
    return (Resolve-Path -LiteralPath $env:CLAUDE_CODE_EXE).Path
  }

  $command = Get-Command claude -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $extensionRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
  if (Test-Path -LiteralPath $extensionRoot) {
    $candidate = Get-ChildItem -LiteralPath $extensionRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^anthropic\.claude-code-([0-9]+(?:\.[0-9]+){2})-win32-x64$' } |
      ForEach-Object {
        $match = [regex]::Match($_.Name, '^anthropic\.claude-code-([0-9]+(?:\.[0-9]+){2})-win32-x64$')
        [pscustomobject]@{
          Version = [version]$match.Groups[1].Value
          Path = Join-Path $_.FullName "resources\native-binary\claude.exe"
        }
      } |
      Where-Object { Test-Path -LiteralPath $_.Path } |
      Sort-Object Version -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.Path
    }
  }

  throw "Claude Code executable was not found. Add claude to PATH or set CLAUDE_CODE_EXE."
}

function Convert-ReviewToMarkdown {
  param([object]$Review, [string]$Base, [string]$ClaudeVersion)

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("# Claude Code review")
  $lines.Add("")
  $lines.Add("- Base: ``$Base``")
  $lines.Add("- Claude Code: ``$ClaudeVersion``")
  $lines.Add("- Verdict: **$($Review.verdict)**")
  $lines.Add("")
  $lines.Add($Review.summary)
  $lines.Add("")
  $lines.Add("## Findings")
  $lines.Add("")
  if (@($Review.findings).Count -eq 0) {
    $lines.Add("No actionable findings.")
  } else {
    foreach ($finding in @($Review.findings)) {
      $location = if ($finding.line) { "$($finding.file):$($finding.line)" } else { "$($finding.file)" }
      $lines.Add("### [$($finding.severity)] $($finding.title)")
      $lines.Add("")
      $lines.Add("- Category: $($finding.category)")
      $lines.Add("- Location: ``$location``")
      $lines.Add("- Evidence: $($finding.evidence)")
      $lines.Add("- Recommendation: $($finding.recommendation)")
      $lines.Add("")
    }
  }
  $lines.Add("## Test gaps")
  $lines.Add("")
  if (@($Review.test_gaps).Count -eq 0) {
    $lines.Add("No additional test gaps reported.")
  } else {
    foreach ($gap in @($Review.test_gaps)) {
      $lines.Add("- $gap")
    }
  }
  return ($lines -join [Environment]::NewLine)
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if (!$repoRoot) {
  throw "Run this script inside a Git repository."
}

$claudeExe = Resolve-ClaudeCodeExecutable
$claudeVersion = (& $claudeExe --version).Trim()
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
$codexVersion = if ($codexCommand) { (& $codexCommand.Source --version).Trim() } else { "not-found" }

Push-Location $repoRoot
try {
  & git rev-parse --verify "$BaseRef^{commit}" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Git base reference was not found: $BaseRef"
  }

  if ($CheckOnly) {
    [pscustomobject]@{
      repository = $repoRoot
      base_ref = $BaseRef
      codex = $codexVersion
      claude = $claudeVersion
      claude_executable = $claudeExe
      status = "ready"
    } | ConvertTo-Json -Depth 5
    exit 0
  }

  if (!$AllowExternalDisclosure) {
    throw "Claude review sends the selected repository diff and readable file context to Anthropic. Re-run with -AllowExternalDisclosure only after the repository owner explicitly approves this disclosure."
  }

  $status = (& git status --short) -join [Environment]::NewLine
  $diffStat = (& git diff --stat $BaseRef --) -join [Environment]::NewLine
  $diff = (& git diff --no-ext-diff --unified=60 $BaseRef --) -join [Environment]::NewLine
  $payload = @"
Repository: $repoRoot
Base reference: $BaseRef

Git status:
$status

Diff stat:
$diffStat

Patch:
$diff

Inspect untracked files listed in Git status with the read-only tools when they are part of this change. Review the complete changed-file context before producing findings.
"@

  if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 8MB) {
    throw "Review input exceeds 8MB. Split the change or choose a closer BaseRef."
  }

  $promptPath = Join-Path $repoRoot ".ai\claude-review-prompt.md"
  $schemaPath = Join-Path $repoRoot ".ai\claude-review-schema.json"
  $systemPrompt = Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8
  $schema = Get-Content -LiteralPath $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress

  $arguments = @(
    "--safe-mode",
    "--no-chrome",
    "--no-session-persistence",
    "--permission-mode", "dontAsk",
    "--tools", "Read,Glob,Grep",
    "--disallowedTools", "Edit,Write,NotebookEdit,Bash,WebFetch,WebSearch",
    "--system-prompt", $systemPrompt,
    "--output-format", "json",
    "--json-schema", $schema,
    "-p", "Review the supplied Codex change set and return the required structured result."
  )

  $rawOutput = $payload | & $claudeExe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Claude Code review failed.`n$rawOutput"
  }
  $response = ($rawOutput -join [Environment]::NewLine) | ConvertFrom-Json
  $review = $response.structured_output
  if (!$review) {
    throw "Claude Code response does not contain structured_output."
  }

  $reviewDir = Join-Path $repoRoot ".ai\reviews"
  New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
  if (!$OutputPath) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputPath = Join-Path $reviewDir "$stamp-claude-review.json"
  } elseif (![System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repoRoot $OutputPath
  }
  $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
  $markdownPath = [System.IO.Path]::ChangeExtension($OutputPath, ".md")

  $report = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    repository = $repoRoot
    base_ref = $BaseRef
    codex_version = $codexVersion
    claude_version = $claudeVersion
    review = $review
  }
  $reportJson = $report | ConvertTo-Json -Depth 30
  $reportMarkdown = Convert-ReviewToMarkdown -Review $review -Base $BaseRef -ClaudeVersion $claudeVersion
  $reportJson | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  $reportMarkdown | Set-Content -LiteralPath $markdownPath -Encoding UTF8

  # Keep stable aliases so Codex can ingest the newest completed local review
  # without asking the repository owner to copy findings into every prompt.
  $latestJsonPath = Join-Path $reviewDir "latest-claude-review.json"
  $latestMarkdownPath = Join-Path $reviewDir "latest-claude-review.md"
  $reportJson | Set-Content -LiteralPath $latestJsonPath -Encoding UTF8
  $reportMarkdown | Set-Content -LiteralPath $latestMarkdownPath -Encoding UTF8

  Write-Host "Claude review: $($review.verdict)"
  Write-Host "JSON: $OutputPath"
  Write-Host "Markdown: $markdownPath"
  Write-Host "Latest JSON: $latestJsonPath"
  Write-Host "Latest Markdown: $latestMarkdownPath"
  foreach ($finding in @($review.findings)) {
    $line = if ($finding.line) { ":$($finding.line)" } else { "" }
    Write-Host "[$($finding.severity)] $($finding.file)$line - $($finding.title)"
  }

  if ($FailOnFindings -and $review.verdict -eq "needs_changes") {
    exit 2
  }
} finally {
  Pop-Location
}
