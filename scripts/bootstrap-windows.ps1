<#
.SYNOPSIS
  One-click Hermes Agent installer for Windows (native, no WSL2 needed)
.USAGE
  powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
.NOTES
  Uses the official install.ps1 from NousResearch/hermes-agent.
  Installs to %LOCALAPPDATA%\hermes by default.
  Logs to %LOCALAPPDATA%\Corey\logs\bootstrap-windows.log
#>
[CmdletBinding()]
param([switch]$SkipElevation, [switch]$Verbose)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($Verbose) { 'Continue' } else { 'SilentlyContinue' }

$LogDir = Join-Path $env:LOCALAPPDATA "Corey\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "bootstrap-windows.log"

function Write-Log([string]$Level, [string]$Msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$ts] [$Level] $Msg" -Encoding UTF8
    switch ($Level) {
        'INFO'  { Write-Host "[+] $Msg" -ForegroundColor Green }
        'WARN'  { Write-Host "[!] $Msg" -ForegroundColor Yellow }
        'ERROR' { Write-Host "[x] $Msg" -ForegroundColor Red }
        default { Write-Host "    $Msg" -ForegroundColor Cyan }
    }
}
function Info($m) { Write-Log 'INFO' $m }
function Warn($m) { Write-Log 'WARN' $m }
function Fail($m) { Write-Log 'ERROR' $m; exit 1 }
function Step($m) { Write-Log 'STEP' $m }

# ── 0. Self-elevation (needed for git/python install if missing) ──
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not $SkipElevation -and -not (Test-Admin)) {
    Info "Requesting admin elevation (may be needed for prerequisites)..."
    try {
        Start-Process -FilePath "powershell.exe" `
            -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`" -SkipElevation" `
            -Verb RunAs -Wait
        Info "Elevated process done. Log: $LogFile"
        exit 0
    } catch {
        Warn "Elevation declined. Continuing as current user."
    }
}

# ── 1. Pre-flight ────────────────────────────────────────────────
Step "Pre-flight checks"

$build = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").CurrentBuild
Info "Windows build $build"

$policy = Get-ExecutionPolicy
if ($policy -in @('Restricted','AllSigned')) {
    Warn "ExecutionPolicy is '$policy'. Script used Bypass override."
    Warn "Fix: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
}

Step "Network connectivity"
try {
    $null = Invoke-WebRequest -Uri "https://raw.githubusercontent.com" -Method Head -TimeoutSec 10 -UseBasicParsing
    Info "GitHub reachable"
} catch {
    Fail "Cannot reach GitHub. Check internet/proxy. Error: $($_.Exception.Message)"
}

# ── 2. Prerequisites ─────────────────────────────────────────────
Step "Prerequisites"

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Info "Git found: $(git --version 2>&1)"
} else {
    Warn "Git not found. Installing..."
    if (Test-Admin) {
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Log 'GIT' $_ }
    } else {
        Info "Downloading Git for Windows..."
        $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
        $gitInstaller = "$env:TEMP\GitInstaller.exe"
        Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing
        Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP-" -Wait
        Remove-Item $gitInstaller -ErrorAction SilentlyContinue
    }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    Get-Command git -ErrorAction SilentlyContinue | Out-Null || Warn "Git may need a terminal restart to be on PATH."
    Info "Git installed"
}

# Python 3.11+ (uv will handle exact version, but we need a bootstrap python)
$pyOk = $false
foreach ($py in @("python", "python3", "py")) {
    try {
        $ver = & $py --version 2>&1
        if ($ver -match '3\.(\d+)') {
            $min = [int]$Matches[1]
            if ($min -ge 11) { $pyOk = $true; Info "Python found: $ver"; break }
        }
    } catch { }
}
if (-not $pyOk) {
    Warn "Python 3.11+ not found. The official installer will use uv to provision it automatically."
}

# ── 3. Run official Hermes installer ─────────────────────────────
Step "Hermes installation (official install.ps1)"

# Determine Corey data dir for HERMES_HOME alignment
$CoreyHermesHome = Join-Path $env:LOCALAPPDATA "Corey\hermes"
$HermesHomeArg = $CoreyHermesHome

# Check if hermes already installed
$hermesInstalled = $false
$existingHome = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
if (Get-Command hermes -ErrorAction SilentlyContinue) {
    Info "Hermes already on PATH: $(Get-Command hermes | Select-Object -ExpandProperty Source)"
    $hermesInstalled = $true
    $verOut = hermes --version 2>&1
    if ($verOut) { Info "Version: $verOut" }
} elseif ($existingHome -and (Test-Path (Join-Path $existingHome "hermes-agent"))) {
    Info "Hermes found at HERMES_HOME=$existingHome"
    $hermesInstalled = $true
}

if (-not $hermesInstalled) {
    Info "Downloading and running official Hermes install.ps1..."
    $installUrl = "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1"
    $installScript = "$env:TEMP\hermes-install.ps1"
    try {
        Invoke-WebRequest -Uri $installUrl -OutFile $installScript -UseBasicParsing
    } catch {
        Fail "Failed to download install.ps1. Error: $($_.Exception.Message)"
    }

    Info "Running install.ps1 with -HermesHome $HermesHomeArg ..."
    try {
        & powershell.exe -ExecutionPolicy Bypass -File $installScript -HermesHome $HermesHomeArg 2>&1 | ForEach-Object { Write-Log 'INSTALL' $_ }
    } catch {
        Warn "Official installer failed: $($_.Exception.Message)"
        Warn "Trying with default HermesHome instead..."
        try {
            & powershell.exe -ExecutionPolicy Bypass -File $installScript 2>&1 | ForEach-Object { Write-Log 'INSTALL' $_ }
        } catch {
            Fail "Hermes installation failed. Try manually: https://hermes-agent.nousresearch.com/docs/getting-started/installation"
        }
    }
    Remove-Item $installScript -ErrorAction SilentlyContinue
    Info "Hermes install completed"
}

# ── 4. Verify installation ────────────────────────────────────────
Step "Verify installation"

# Refresh PATH for current session
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
$env:HERMES_HOME = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")

if (Get-Command hermes -ErrorAction SilentlyContinue) {
    Info "hermes command available: $(Get-Command hermes | Select-Object -ExpandProperty Source)"
} else {
    # Fallback: try venv path directly
    $venvBin = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\venv\Scripts\hermes.exe"
    if (Test-Path $venvBin) {
        Info "Hermes found at: $venvBin"
        $venvDir = Split-Path $venvBin
        $curPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($curPath -notlike "*$venvDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$venvDir;$curPath", "User")
            $env:Path = "$venvDir;$env:Path"
            Info "Added $venvDir to user PATH"
        }
    } else {
        Fail "Hermes binary not found. Check %LOCALAPPDATA%\hermes\ manually."
    }
}

# ── 5. Align HERMES_HOME with Corey data dir ─────────────────────
Step "HERMES_HOME alignment"

$currentHome = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
if (-not $currentHome) {
    [Environment]::SetEnvironmentVariable("HERMES_HOME", $CoreyHermesHome, "User")
    $env:HERMES_HOME = $CoreyHermesHome
    Info "Set HERMES_HOME=$CoreyHermesHome"
} elseif ($currentHome -ne $CoreyHermesHome) {
    Info "HERMES_HOME already set to: $currentHome"
    Info "Corey prefers: $CoreyHermesHome"
    Info "To align: [Environment]::SetEnvironmentVariable('HERMES_HOME', '$CoreyHermesHome', 'User')"
} else {
    Info "HERMES_HOME aligned: $currentHome"
}

# ── 6. Start gateway ──────────────────────────────────────────────
Step "Starting Hermes gateway"

try {
    $gwOut = hermes gateway start 2>&1
    Write-Log 'GATEWAY' $gwOut
    Info "Gateway start output: $gwOut"
} catch {
    Warn "Gateway start failed: $($_.Exception.Message)"
    Warn "You can start it manually: hermes gateway start"
}

# ── 7. Summary ────────────────────────────────────────────────────
$finalHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { [Environment]::GetEnvironmentVariable("HERMES_HOME", "User") }
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Hermes bootstrap complete (native Windows)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  HERMES_HOME:  $finalHome"
Write-Host "  Log file:     $LogFile"
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1) hermes model              (choose LLM provider)"
Write-Host "  2) hermes gateway start      (start messaging gateway)"
Write-Host "  3) Open Corey — auto-detects Hermes"
Write-Host ""
Write-Host "  Troubleshooting:" -ForegroundColor Yellow
Write-Host "  - hermes gateway status      (check if running)"
Write-Host "  - hermes doctor              (diagnose issues)"
Write-Host "  - Re-run this script anytime (idempotent)"
Write-Host "============================================================" -ForegroundColor Cyan
