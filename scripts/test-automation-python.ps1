$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repositoryRoot 'automation-service\backend\.venv\Scripts\python.exe'
$pythonCommand = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { 'python' }

& $pythonCommand -m unittest discover -s tests -p 'test_*.py'
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
