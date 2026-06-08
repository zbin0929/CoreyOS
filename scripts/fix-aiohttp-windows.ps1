<#
.SYNOPSIS
  Fix Hermes gateway "aiohttp not installed / no adapter for api_server" (Windows).
.DESCRIPTION
  Since Hermes v0.14.0 aiohttp is a lazy optional dependency. The bundled
  hermes-standalone.exe ships without it, so the gateway starts but cannot
  serve the API and Corey fails to connect.
  This script:
    1) pip install/upgrade hermes-agent + aiohttp (a real Hermes with aiohttp)
    2) rename Corey's bundled hermes-standalone.exe so Corey uses the PATH hermes
    3) verify aiohttp imports
.USAGE
  powershell -ExecutionPolicy Bypass -File .\scripts\fix-aiohttp-windows.ps1
#>
[CmdletBinding()]
param(
    [string]$CoreyInstallDir
)

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "[+] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

Step "1/3 Install/upgrade hermes-agent + aiohttp"
$python = $null
foreach ($cmd in @('python', 'python3')) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $python = $cmd; break }
}
if (-not $python) {
    Warn "Python not found. Install Python 3.11+ first: https://python.org"
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
}
Info "Using Python: $(& $python --version 2>&1)"
& $python -m pip install --upgrade hermes-agent aiohttp
& $python -c "import aiohttp; print('aiohttp', aiohttp.__version__, 'OK')"

# Ensure the pip Scripts dir (where hermes.exe lands) is on the user PATH,
# otherwise Corey's resolve_hermes_binary() cannot locate the new hermes
# after the bundled exe is renamed below.
$scriptsDir = (& $python -c "import sysconfig; print(sysconfig.get_path('scripts'))").Trim()
if ($scriptsDir -and (Test-Path (Join-Path $scriptsDir 'hermes.exe'))) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$scriptsDir*") {
        [Environment]::SetEnvironmentVariable('Path', "$scriptsDir;$userPath", 'User')
        $env:Path = "$scriptsDir;$env:Path"
        Info "Added hermes to PATH: $scriptsDir"
    } else {
        Info "hermes Scripts dir already on PATH: $scriptsDir"
    }
} else {
    Warn "hermes.exe not found under '$scriptsDir' - check the pip install output."
}

Step "2/3 Point Corey at the hermes with aiohttp (rename bundled exe)"
# Locate Corey install dir: prefer the param, otherwise probe common locations.
$candidates = @()
if ($CoreyInstallDir) { $candidates += $CoreyInstallDir }
$progFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
$progFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Corey')
if ($progFiles) { $candidates += (Join-Path $progFiles 'Corey') }
if ($progFilesX86) { $candidates += (Join-Path $progFilesX86 'Corey') }

$renamed = $false
foreach ($dir in $candidates) {
    if (-not $dir) { continue }
    $exe = Join-Path $dir 'binaries\hermes-standalone.exe'
    if (Test-Path $exe) {
        $bak = "$exe.bak"
        if (Test-Path $bak) { Remove-Item $bak -Force }
        Rename-Item -Path $exe -NewName 'hermes-standalone.exe.bak' -Force
        Info "Renamed: $exe -> hermes-standalone.exe.bak"
        $renamed = $true
        break
    }
}
if (-not $renamed) {
    Warn "Could not auto-find Corey's binaries\hermes-standalone.exe."
    Warn "If Corey is installed elsewhere, re-run with: -CoreyInstallDir 'C:\Path\To\Corey'"
    Warn "Or manually rename <CoreyDir>\binaries\hermes-standalone.exe to .bak"
}

Step "3/3 Done"
Info "Fully quit and restart Corey; it will use the PATH hermes that has aiohttp."
Info "If it still won't connect: check 'hermes --version' works in a new terminal (venv\Scripts on PATH)."
Write-Host "`nPress any key to close..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
