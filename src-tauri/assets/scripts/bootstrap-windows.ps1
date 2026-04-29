<#
.SYNOPSIS
  One-click Hermes Agent installer for Windows (native, no WSL2 needed)
.USAGE
  powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
.NOTES
  Uses ghfast.top mirror for git clone, tuna.tsinghua.edu.cn for PyPI.
  Installs to %LOCALAPPDATA%\hermes\hermes-agent by default.
  Logs to %LOCALAPPDATA%\Corey\logs\bootstrap-windows.log
#>
[CmdletBinding()]
param([switch]$SkipElevation, [switch]$VerboseLog)

$ErrorActionPreference = 'Stop'

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

# ── 0. Self-elevation ────────────────────────────────────────────
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
}

# ── 2. Prerequisites: Git ────────────────────────────────────────
Step "Prerequisites"

if (Get-Command git -ErrorAction SilentlyContinue) {
    Info "Git found: $(git --version 2>&1)"
} else {
    Warn "Git not found. Installing via winget..."
    if (Test-Admin) {
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Log 'GIT' $_ }
    } else {
        Fail "Git not found. Please install Git for Windows first: https://git-scm.com/download/win"
    }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn "Git may need a terminal restart to be on PATH." }
    Info "Git installed"
}

# ── 2b. Windows native compatibility fixes ───────────────────────
Step "Windows compatibility patches"

$env:PYTHONIOENCODING = "utf-8"
[Environment]::SetEnvironmentVariable("PYTHONIOENCODING", "utf-8", "User")
Info "Set PYTHONIOENCODING=utf-8"

$bashExe = $null
$candidates = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe"
)
foreach ($c in $candidates) {
    if (Test-Path $c) { $bashExe = $c; break }
}
if (-not $bashExe -and (Get-Command git -ErrorAction SilentlyContinue)) {
    $gitRoot = (Get-Command git | Select-Object -ExpandProperty Source | Split-Path | Split-Path)
    $probe = Join-Path $gitRoot "bin\bash.exe"
    if (Test-Path $probe) { $bashExe = $probe }
}
if ($bashExe) {
    $bashDir = Split-Path $bashExe
    $curPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($curPath -notlike "*$bashDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$bashDir;$curPath", "User")
        $env:Path = "$bashDir;$env:Path"
        Info "Added Git Bash to PATH: $bashDir"
    } else {
        Info "Git Bash already on PATH"
    }
} else {
    Warn "Git Bash not found. Code execution features may not work."
}

# ── 3. Install Hermes Agent ──────────────────────────────────────
Step "Hermes installation (git clone + uv)"

$HermesDir = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent"

if (Get-Command hermes -ErrorAction SilentlyContinue) {
    Info "Hermes already on PATH: $(Get-Command hermes | Select-Object -ExpandProperty Source)"
    Info "Version: $(hermes --version 2>&1)"
} elseif (Test-Path (Join-Path $HermesDir "venv\Scripts\hermes.exe")) {
    Info "Hermes found at $HermesDir\venv"
} else {
    Info "Cloning hermes-agent via ghfast.top mirror..."
    $hermesParent = Split-Path $HermesDir
    if (-not (Test-Path $hermesParent)) { New-Item -ItemType Directory -Path $hermesParent -Force | Out-Null }

    if (Test-Path $HermesDir) {
        Info "Existing hermes-agent directory found, pulling latest..."
        Push-Location $HermesDir
        try {
            git pull 2>&1 | ForEach-Object { Write-Log 'GIT' $_ }
        } catch {
            Warn "git pull failed, using existing checkout"
        }
        Pop-Location
    } else {
        try {
            git clone "https://ghfast.top/https://github.com/NousResearch/hermes-agent.git" $HermesDir 2>&1 | ForEach-Object { Write-Log 'GIT' $_ }
        } catch {
            Warn "ghfast.top mirror failed, trying direct GitHub..."
            try {
                git clone "https://github.com/NousResearch/hermes-agent.git" $HermesDir 2>&1 | ForEach-Object { Write-Log 'GIT' $_ }
            } catch {
                Fail "git clone failed. Check network connectivity. Error: $($_.Exception.Message)"
            }
        }
    }
    Info "Clone complete"

    # Install uv if not present
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Info "Installing uv..."
        try {
            $installUvScript = "$env:TEMP\install-uv.ps1"
            Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -OutFile $installUvScript -UseBasicParsing
            & powershell.exe -ExecutionPolicy Bypass -File $installUvScript 2>&1 | ForEach-Object { Write-Log 'UV' $_ }
            Remove-Item $installUvScript -ErrorAction SilentlyContinue
            $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
        } catch {
            Fail "uv install failed: $($_.Exception.Message)"
        }
    }

    Info "Creating venv and installing hermes-agent..."
    Push-Location $HermesDir
    try {
        uv venv venv --python 3.11 2>&1 | ForEach-Object { Write-Log 'VENV' $_ }
        uv pip install -e "." --index-url "https://pypi.tuna.tsinghua.edu.cn/simple" 2>&1 | ForEach-Object { Write-Log 'PIP' $_ }
    } catch {
        Pop-Location
        Fail "Hermes install failed: $($_.Exception.Message)"
    }
    Pop-Location
    Info "Hermes install complete"
}

# ── 3b. Ensure hermes on PATH ────────────────────────────────────
$hermesBin = Join-Path $HermesDir "venv\Scripts"
$curPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($curPath -notlike "*$hermesBin*") {
    [Environment]::SetEnvironmentVariable("Path", "$hermesBin;$curPath", "User")
    $env:Path = "$hermesBin;$env:Path"
    Info "Added $hermesBin to user PATH"
}

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

# ── 3c. Windows native patches ───────────────────────────────────
Step "Windows native patches"

$statusFile = Join-Path $HermesDir "hermes_cli\gateway\status.py"
if (Test-Path $statusFile) {
    $content = Get-Content $statusFile -Raw -Encoding UTF8
    if ($content -match 'os\.kill\(pid,\s*0\)') {
        Info "Patching os.kill(pid, 0) in status.py for Windows compatibility..."
        $patched = $content -replace 'os\.kill\(pid,\s*0\)', 'os.kill(pid, 0)  # patched by Corey bootstrap'
        $patched = $patched -replace '(?m)^(\s*)([^\s#].*?)os\.kill\(pid,\s*0\)\s*#\s*patched by Corey bootstrap\s*$', @'
$1try:
$1    $2os.kill(pid, 0)  # patched by Corey bootstrap
$1except (ProcessLookupError, PermissionError, OSError, SystemError):
$1    return False
'@
        Set-Content $statusFile -Value $patched -Encoding UTF8 -NoNewline
        Info "Patched status.py"
    } else {
        Info "status.py already patched or does not use os.kill(pid, 0)"
    }
}

# ── 4. Verify installation ───────────────────────────────────────
Step "Verify installation"

if (Get-Command hermes -ErrorAction SilentlyContinue) {
    Info "hermes command available: $(hermes --version 2>&1)"
} else {
    Fail "Hermes binary not found in $hermesBin"
}

# ── 5. Configure HERMES_HOME ─────────────────────────────────────
Step "HERMES_HOME configuration"

$CoreyHermesHome = Join-Path $env:LOCALAPPDATA "Corey\hermes"
$currentHome = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")

if (-not $currentHome) {
    $hermesHome = Join-Path $env:USERPROFILE ".hermes"
    [Environment]::SetEnvironmentVariable("HERMES_HOME", $hermesHome, "User")
    $env:HERMES_HOME = $hermesHome
    Info "Set HERMES_HOME=$hermesHome"
} else {
    $env:HERMES_HOME = $currentHome
    Info "HERMES_HOME=$currentHome"
}

if (-not (Test-Path $env:HERMES_HOME)) {
    New-Item -ItemType Directory -Path $env:HERMES_HOME -Force | Out-Null
}

# ── 5.5. API key check ───────────────────────────────────────────
Step "API key check"

$envFile = Join-Path $env:HERMES_HOME ".env"
$script:HasApiKey = $false
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Encoding UTF8
    foreach ($line in $envContent) {
        if ($line -match '^\s*(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(.+)$') {
            $val = $Matches[2].Trim().Trim('"').Trim("'")
            if ($val -and $val -ne 'your-key-here' -and $val -notmatch '<') {
                $script:HasApiKey = $true
                Info "Found: $($Matches[1])"
                break
            }
        }
    }
}
if (-not $script:HasApiKey) {
    Warn "No API key found in $envFile"
    Warn "You need at least one provider key to use Hermes."
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
$finalHome = $env:HERMES_HOME
$hermesVer = ""
try { $hermesVer = hermes --version 2>&1 } catch { $hermesVer = "unknown" }
$gwRunning = $false
try { $null = hermes gateway status 2>&1; $gwRunning = $true } catch { }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Hermes bootstrap complete (native Windows)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Version:      $hermesVer"
Write-Host "  Install dir:  $HermesDir"
Write-Host "  HERMES_HOME:  $finalHome"
Write-Host "  Gateway:      $(if ($gwRunning) { 'running' } else { 'not running' })"
Write-Host "  Log file:     $LogFile"
Write-Host ""
if (-not $script:HasApiKey) {
    Write-Host "  WARNING: No API key configured!" -ForegroundColor Yellow
    Write-Host "           hermes model   (choose provider + enter key)" -ForegroundColor Yellow
    Write-Host ""
}
Write-Host "  Next steps:" -ForegroundColor Yellow
if (-not $gwRunning) { Write-Host "  1) hermes gateway start" } else { Write-Host "  1) Gateway already running" }
if (-not $script:HasApiKey) { Write-Host "  2) hermes model              (choose LLM provider)" }
Write-Host "  3) Open Corey - auto-detects Hermes"
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
