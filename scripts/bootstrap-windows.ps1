<#
.SYNOPSIS
  One-click Hermes installer for Windows (WSL2 required)

.USAGE
  PowerShell (as Administrator recommended for first-time WSL install):
    powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
#>

$ErrorActionPreference = 'Stop'

function Info($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }

# 1) Ensure WSL exists
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
  Warn "WSL not found. Installing WSL2 (requires admin + reboot)..."
  wsl --install
  Warn "WSL installed. Please reboot Windows, then rerun this script."
  exit 0
}

# 2) Ensure at least one distro is installed
$distros = wsl -l -q 2>$null
if (-not $distros -or $distros.Count -eq 0) {
  Warn "No WSL distro detected. Installing Ubuntu..."
  wsl --install -d Ubuntu
  Warn "Ubuntu installation initialized. Please open Ubuntu once to finish first-run setup, then rerun this script."
  exit 0
}

# Pick default distro (first line)
$distro = ($distros | Select-Object -First 1).Trim()
Info "Using WSL distro: $distro"

# 3) Install Hermes in WSL
Info "Installing Hermes inside WSL..."
$installCmd = @"
set -e
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
"@

wsl -d $distro -e bash -lc $installCmd

# 4) Create shared data dir on Windows and map to WSL path
$winHermesDir = Join-Path $env:LOCALAPPDATA "Corey\hermes"
if (-not (Test-Path $winHermesDir)) {
  New-Item -ItemType Directory -Path $winHermesDir -Force | Out-Null
}
Info "Corey/Hermes shared data dir: $winHermesDir"

$drive = $winHermesDir.Substring(0,1).ToLower()
$rest = $winHermesDir.Substring(2).Replace('\\','/')
$rest = $rest.TrimStart('/')
$wslHermesDir = "/mnt/$drive/$rest"

# 5) Persist HERMES_HOME in WSL shell profile
Info "Persisting HERMES_HOME in WSL profile..."
$envCmd = @"
set -e
grep -q 'export HERMES_HOME=' ~/.bashrc || echo 'export HERMES_HOME=$wslHermesDir' >> ~/.bashrc
export HERMES_HOME=$wslHermesDir
mkdir -p "`$HERMES_HOME"
"@
wsl -d $distro -e bash -lc $envCmd

# 6) Start gateway
Info "Starting Hermes gateway in WSL..."
$startCmd = @"
set -e
export HERMES_HOME=$wslHermesDir
nohup hermes gateway start >/tmp/hermes-gateway.log 2>&1 &
sleep 2
hermes gateway status || true
"@
wsl -d $distro -e bash -lc $startCmd

Write-Host ""
Write-Host "────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "Hermes bootstrap complete." -ForegroundColor Cyan
Write-Host "" 
Write-Host "WSL distro:   $distro"
Write-Host "Windows path: $winHermesDir"
Write-Host "WSL path:     $wslHermesDir"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1) Open Corey on Windows"
Write-Host "2) In Settings, ensure data directory is: $winHermesDir"
Write-Host "3) Use 'Restart Gateway' once from Corey to verify bridge"
Write-Host "────────────────────────────────────────────────────────────" -ForegroundColor Cyan
