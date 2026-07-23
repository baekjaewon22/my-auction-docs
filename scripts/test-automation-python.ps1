$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repositoryRoot 'automation-service\backend\.venv\Scripts\python.exe'
$pythonCommand = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { 'python' }

& $pythonCommand -m unittest tests.test_automation_security tests.test_automation_installer
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
