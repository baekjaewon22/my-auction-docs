[CmdletBinding()]
param(
  [string]$BaseUrl = 'https://my-docs.kr',
  [string]$KeyName = 'Claude Cowork external mention collector',
  [string]$SecretPath = ''
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')

if (-not $SecretPath) {
  # ASCII-only source keeps Windows PowerShell 5 from corrupting the Korean folder name.
  $marketingCheckFolder = -join ([char[]](0xB9C8, 0xCF00, 0xD305, 0xC810, 0xAC80))
  $SecretPath = Join-Path $env:USERPROFILE "Desktop\$marketingCheckFolder\.secrets\MYDOCS_MENTIONS_API_KEY.txt"
}

Write-Host 'my-docs.kr master login is required.' -ForegroundColor Cyan
$masterEmail = Read-Host 'Master account email'
$masterPassword = Read-Host 'Master account password' -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new($masterEmail, $masterPassword)
$loginBody = @{
  email = $credential.UserName
  password = $credential.GetNetworkCredential().Password
  login_type = 'employee'
} | ConvertTo-Json -Compress

$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json; charset=utf-8' -Body $loginBody
if ($login.user.role -ne 'master') {
  throw 'Only a master account can issue this API key.'
}

$authHeaders = @{ Authorization = "Bearer $($login.token)" }
$keyBody = @{ name = $KeyName } | ConvertTo-Json -Compress
$issued = Invoke-RestMethod -Method Post -Uri "$base/api/mentions/keys" -Headers $authHeaders -ContentType 'application/json; charset=utf-8' -Body $keyBody
$apiKey = [string]$issued.token
if (-not $apiKey.StartsWith('mmn_')) {
  throw 'The issued key does not have the expected mmn_ prefix.'
}

$secretDirectory = Split-Path -Parent $SecretPath
New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
[System.IO.File]::WriteAllText($SecretPath, $apiKey, [System.Text.UTF8Encoding]::new($false))
[Environment]::SetEnvironmentVariable('MYDOCS_MENTIONS_API_KEY', $apiKey, 'User')

$apiHeaders = @{ 'X-API-Key' = $apiKey }
$now = [DateTimeOffset]::Now
$runId = 'key-check-' + $now.ToString('yyyyMMddHHmmss')
$batchDryRun = @{
  run = @{
    run_id = $runId
    started_at = $now.ToString('o')
    finished_at = $now.ToString('o')
    status = 'success'
    sources = @()
  }
  mentions = @()
} | ConvertTo-Json -Depth 8 -Compress
$batchResult = Invoke-RestMethod -Method Post -Uri "$base/api/mentions/batch?dry_run=1" -Headers $apiHeaders -ContentType 'application/json; charset=utf-8' -Body $batchDryRun

$date = $now.ToString('yyyy-MM-dd')
$digestDryRun = @{
  report_key = "myauction_mentions_key_check_$date"
  report_date = $date
  period = @{ start = $now.ToString('o'); end = $now.ToString('o') }
  summary = @{
    status = 'normal'
    headline = 'API key validation'
    description = 'This dry run is not stored.'
    what_changed = @()
    what_to_check = @()
  }
  stats = @{}
  urgent_mentions = @()
  top_topics = @()
  emerging_issues = @()
  repeated_issues = @()
  positive_mentions = @()
  source_breakdown = @()
  keyword_breakdown = @()
  discovered_keywords = @()
  data_quality = @()
} | ConvertTo-Json -Depth 8 -Compress
$digestResult = Invoke-RestMethod -Method Post -Uri "$base/api/mention-digests?dry_run=1" -Headers $apiHeaders -ContentType 'application/json; charset=utf-8' -Body $digestDryRun

Write-Host 'External mention API key issued successfully.' -ForegroundColor Green
Write-Host "Key prefix: $($issued.api_key.token_prefix)..."
Write-Host "Saved to: $SecretPath"
Write-Host 'User environment variable: MYDOCS_MENTIONS_API_KEY'
Write-Host "Mention batch dry_run: $($batchResult.valid)"
Write-Host "Daily digest dry_run: $($digestResult.valid)"
Write-Host 'The full key was not printed.'
