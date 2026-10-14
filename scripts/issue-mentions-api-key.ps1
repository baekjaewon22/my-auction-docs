[CmdletBinding()]
param(
  [string]$BaseUrl = 'https://my-docs.kr',
  [string]$KeyName = 'Claude Cowork 외부 언급 수집',
  [string]$SecretPath = (Join-Path $env:USERPROFILE 'Desktop\마케팅점검\.secrets\MYDOCS_MENTIONS_API_KEY.txt')
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$credential = Get-Credential -Message 'my-docs.kr 마스터 계정의 이메일과 비밀번호를 입력하세요.'
$loginBody = @{
  email = $credential.UserName
  password = $credential.GetNetworkCredential().Password
  login_type = 'employee'
} | ConvertTo-Json -Compress

$login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json; charset=utf-8' -Body $loginBody
if ($login.user.role -ne 'master') {
  throw 'API 키 발급은 마스터 계정으로만 가능합니다.'
}

$authHeaders = @{ Authorization = "Bearer $($login.token)" }
$keyBody = @{ name = $KeyName } | ConvertTo-Json -Compress
$issued = Invoke-RestMethod -Method Post -Uri "$base/api/mentions/keys" -Headers $authHeaders -ContentType 'application/json; charset=utf-8' -Body $keyBody
$apiKey = [string]$issued.token
if (-not $apiKey.StartsWith('mmn_')) {
  throw '외부 언급 전용 키 형식이 올바르지 않습니다.'
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
  summary = @{ status = 'normal'; headline = 'API 키 검증용 보고서'; description = '저장되지 않는 dry run입니다.'; what_changed = @(); what_to_check = @() }
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

Write-Host '외부 언급 전용 API 키 발급이 완료되었습니다.' -ForegroundColor Green
Write-Host "키 접두사: $($issued.api_key.token_prefix)..."
Write-Host "저장 경로: $SecretPath"
Write-Host '사용자 환경변수: MYDOCS_MENTIONS_API_KEY'
Write-Host "개별 언급 dry_run: $($batchResult.valid)"
Write-Host "일일 보고 dry_run: $($digestResult.valid)"
Write-Host '보안을 위해 키 원문은 화면에 출력하지 않았습니다.'
