param(
  [string]$Version = "2026.07.14.4",
  [int]$Port = 8001
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "automation-service\backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$agentName = "MyAuctionAutomationAgent"
$buildRoot = Join-Path $root "automation-service\build-agent"
$packageDir = Join-Path $buildRoot $agentName
$downloadDir = Join-Path $root "automation-service\releases"
$zipPath = Join-Path $downloadDir "$agentName.zip"
$setupName = "MyAuctionAutomationAgentSetup"
$setupScript = Join-Path $root "automation-service\installer\setup_agent.py"
$setupExePath = Join-Path $downloadDir "$setupName.exe"
$popplerCandidates = @(
  (Join-Path $backendDir "bin\poppler\Library\bin"),
  "C:\poppler\Library\bin",
  "C:\poppler-25.12.0\Library\bin"
)
$popplerBin = $popplerCandidates | Where-Object {
  (Test-Path -LiteralPath (Join-Path $_ "pdfinfo.exe")) -and
  (Test-Path -LiteralPath (Join-Path $_ "pdftoppm.exe"))
} | Select-Object -First 1

if (!(Test-Path $venvPython)) {
  throw "Python virtual environment was not found: $venvPython"
}
if (!(Test-Path $setupScript)) {
  throw "Setup script was not found: $setupScript"
}
if (!$popplerBin) {
  throw "Poppler was not found. pdfinfo.exe and pdftoppm.exe are required to build the automation agent."
}

Push-Location $backendDir
try {
  & $venvPython -m PyInstaller --version *> $null
  if ($LASTEXITCODE -ne 0) {
    & $venvPython -m pip install -r requirements.txt
  }

  & $venvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --noconsole `
    --name $agentName `
    --paths $backendDir `
    --hidden-import selenium.webdriver.chrome.webdriver `
    --hidden-import selenium.webdriver.chrome.options `
    --hidden-import selenium.webdriver.chrome.service `
    --hidden-import selenium.webdriver.common.driver_finder `
    --add-binary "$popplerBin;bin/poppler/Library/bin" `
    --add-data "templates;templates" `
    run_server.py
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller build failed."
  }
}
finally {
  Pop-Location
}

if (Test-Path $buildRoot) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

$pyinstallerDist = Join-Path $backendDir "dist\$agentName"
Copy-Item -Path (Join-Path $pyinstallerDist "*") -Destination $packageDir -Recurse -Force

$installScript = @(
  '$ErrorActionPreference = "Stop"',
  '',
  (' $agentName = "{0}"' -f $agentName).TrimStart(),
  '$installDir = Join-Path $env:LOCALAPPDATA $agentName',
  '$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
  ('$exePath = Join-Path $installDir "{0}.exe"' -f $agentName),
  ('$port = "{0}"' -f $Port),
  '',
  'New-Item -ItemType Directory -Force -Path $installDir | Out-Null',
  'Copy-Item -LiteralPath (Join-Path $sourceDir "*") -Destination $installDir -Recurse -Force',
  '',
  ('$runnerPath = Join-Path $installDir "Start-{0}.ps1"' -f $agentName),
  '$runner = @(',
  '  ''$ErrorActionPreference = "Stop"''',
  ('  ''$exe = Join-Path $PSScriptRoot "{0}.exe"''' -f $agentName),
  ('  ''Start-Process -FilePath $exe -ArgumentList "{0}" -WindowStyle Hidden''' -f $Port),
  ') -join [Environment]::NewLine',
  'Set-Content -LiteralPath $runnerPath -Value $runner -Encoding UTF8',
  '',
  '$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"',
  'New-Item -Path $runKey -Force | Out-Null',
  'Set-ItemProperty -Path $runKey -Name $agentName -Value ("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{0}""" -f $runnerPath)',
  '',
  'Start-Process -FilePath $exePath -ArgumentList $port -WindowStyle Hidden',
  'Write-Host "MyAuction automation agent installed and started."',
  ('Write-Host "Health: http://127.0.0.1:{0}/api/health"' -f $Port)
) -join [Environment]::NewLine

Set-Content -LiteralPath (Join-Path $packageDir "install.ps1") -Value $installScript -Encoding UTF8

$readme = @"
# MyAuction Automation Agent

Version: $Version

권장 설치 방법
1. MyAuctionAutomationAgentSetup.exe를 실행합니다.
2. 설치 완료 안내가 뜨면 업무 시스템에서 "설치 후 다시 확인"을 누릅니다.

수동 설치가 필요한 경우에만 이 압축 파일을 해제한 뒤 install.ps1을 실행합니다.
설치 후 자동화 실행기는 Windows 로그인 시 자동 실행됩니다.
상태 확인 주소: http://127.0.0.1:$Port/api/health
"@

Set-Content -LiteralPath (Join-Path $packageDir "README.txt") -Value $readme -Encoding UTF8

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

Write-Host "Created $zipPath"

$setupBuildDir = Join-Path $buildRoot "setup-build"
$setupSpecDir = Join-Path $buildRoot "setup-spec"
New-Item -ItemType Directory -Force -Path $setupBuildDir, $setupSpecDir | Out-Null
if (Test-Path $setupExePath) {
  Remove-Item -LiteralPath $setupExePath -Force
}

& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --noconsole `
  --name $setupName `
  --distpath $downloadDir `
  --workpath $setupBuildDir `
  --specpath $setupSpecDir `
  --add-data "$zipPath;." `
  $setupScript
if ($LASTEXITCODE -ne 0) {
  throw "Setup PyInstaller build failed."
}

Write-Host "Created $setupExePath"
