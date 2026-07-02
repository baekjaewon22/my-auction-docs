$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "automation-service\backend"

if (-not (Test-Path -LiteralPath $backendDir)) {
  throw "auction-report-web backend directory was not found: $backendDir"
}

Set-Location -LiteralPath $backendDir

if (-not (Test-Path -LiteralPath "app\main.py")) {
  throw "FastAPI entrypoint was not found under $backendDir"
}

$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }

$env:AUCTION_REPORT_HOST = if ($env:AUCTION_REPORT_HOST) { $env:AUCTION_REPORT_HOST } else { "127.0.0.1" }
$env:AUCTION_REPORT_PORT = if ($env:AUCTION_REPORT_PORT) { $env:AUCTION_REPORT_PORT } else { "8000" }

Write-Host "Starting Python Automation Service..."
Write-Host "Backend: $backendDir"
Write-Host "Python:  $python"
Write-Host "Health:  http://$env:AUCTION_REPORT_HOST`:$env:AUCTION_REPORT_PORT/api/health"

& $python -X utf8 -m uvicorn app.main:app --host $env:AUCTION_REPORT_HOST --port $env:AUCTION_REPORT_PORT
