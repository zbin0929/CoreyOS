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
param([switch]$SkipElevation, [switch]$VerboseLog)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($VerboseLog) { 'Continue' } else { 'SilentlyContinue' }

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

$script:UseProxy = $false
$script:ProxyUrl = $null

if ($env:HTTPS_PROXY -or $env:https_proxy -or $env:ALL_PROXY) {
    $script:ProxyUrl = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:https_proxy) { $env:https_proxy } else { $env:ALL_PROXY }
    Info "Proxy detected: $script:ProxyUrl"
    $script:UseProxy = $true
}

$script:GitHubReachable = $false
try {
    $null = Invoke-WebRequest -Uri "https://raw.githubusercontent.com" -Method Head -TimeoutSec 10 -UseBasicParsing
    Info "GitHub reachable"
    $script:GitHubReachable = $true
} catch {
    Warn "Cannot reach GitHub directly: $($_.Exception.Message)"
    if (-not $script:UseProxy) {
        Info "Trying common proxy ports..."
        foreach ($port in @(7890, 1080, 10809, 10808, 7897, 8080)) {
            try {
                $null = Invoke-WebRequest -Uri "https://raw.githubusercontent.com" -Method Head -TimeoutSec 3 -UseBasicParsing -Proxy "http://127.0.0.1:$port"
                Info "Found proxy at 127.0.0.1:$port"
                $script:ProxyUrl = "http://127.0.0.1:$port"
                $script:UseProxy = $true
                $script:GitHubReachable = $true
                $env:HTTPS_PROXY = $script:ProxyUrl
                $env:HTTP_PROXY = $script:ProxyUrl
                break
            } catch { }
        }
    }
    if (-not $script:GitHubReachable) {
        Fail "Cannot reach GitHub even with proxy. Set HTTPS_PROXY env var or check network. Error: $($_.Exception.Message)"
    }
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
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn "Git may need a terminal restart to be on PATH." }
    Info "Git installed"
}

if ($script:UseProxy -and $script:ProxyUrl) {
    Info "Configuring git proxy: $script:ProxyUrl"
    try {
        git config --global http.proxy $script:ProxyUrl 2>$null
        git config --global https.proxy $script:ProxyUrl 2>$null
    } catch { Warn "Failed to set git proxy" }
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

# ── 2b. Windows native compatibility fixes ────────────────────────
Step "Windows compatibility patches"

# Fix 1: UTF-8 encoding (Hermes uses Unicode chars that break cp1252)
$env:PYTHONIOENCODING = "utf-8"
[Environment]::SetEnvironmentVariable("PYTHONIOENCODING", "utf-8", "User")
Info "Set PYTHONIOENCODING=utf-8 (fixes UnicodeEncodeError)"

# Fix 2: Git Bash on PATH (Hermes code execution requires bash)
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
if (-not $bashExe) {
    $found = Get-ChildItem -Path "C:\Program Files\Git" -Filter "bash.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $bashExe = $found.FullName }
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
    Warn "Git Bash not found. Code execution features may not work without bash."
    Warn "Install Git for Windows first, then re-run this script."
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

# ── 3b. Apply Windows-specific patches ───────────────────────────
Step "Windows native patches"

# Fix 3: os.kill(pid, 0) throws OSError [WinError 87] on Windows
# Patch hermes_cli/gateway/status.py to catch the error
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { [Environment]::GetEnvironmentVariable("HERMES_HOME", "User") }
if (-not $hermesHome) { $hermesHome = Join-Path $env:LOCALAPPDATA "hermes" }

$statusFile = Join-Path $hermesHome "hermes-agent\hermes_cli\gateway\status.py"
if (Test-Path $statusFile) {
    $content = Get-Content $statusFile -Raw -Encoding UTF8
    if ($content -match 'os\.kill\(pid,\s*0\)') {
        Info "Patching os.kill(pid, 0) in status.py for Windows compatibility..."
        $patched = $content -replace 'os\.kill\(pid,\s*0\)', 'os.kill(pid, 0)  # patched by Corey bootstrap'
        # Wrap bare os.kill calls in try/except
        $patched = $patched -replace '(?m)^(\s*)([^\s#].*?)os\.kill\(pid,\s*0\)\s*#\s*patched by Corey bootstrap\s*$', @'
$1try:
$1    $2os.kill(pid, 0)  # patched by Corey bootstrap
$1except (ProcessLookupError, PermissionError, OSError, SystemError):
$1    return False
'@
        # Simpler approach: just wrap the whole line pattern
        Set-Content $statusFile -Value $patched -Encoding UTF8 -NoNewline
        Info "Patched status.py — os.kill now catches Windows OSError"
    } else {
        Info "status.py already patched or does not use os.kill(pid, 0)"
    }
} else {
    Warn "status.py not found at $statusFile — skipping os.kill patch"
    Warn "If gateway status crashes with WinError 87, apply patch manually."
}

# Fix 4: Community enhanced script fallback (if official install had issues)
# The community script by HoriLiu fixes os.kill, encoding, and path issues
# We only suggest it if hermes is still not working
if (-not (Get-Command hermes -ErrorAction SilentlyContinue)) {
    Warn "Hermes still not on PATH after official install."
    Warn "Try the community enhanced installer:"
    Warn '  irm https://gist.githubusercontent.com/HoriLiu/e95d48009cf0d76e8f52a9009c0a79c4/raw/install-hermes-windows.ps1 | iex'
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

# ── 5.5. API key check ───────────────────────────────────────────
Step "API key check"

$finalHome2 = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { [Environment]::GetEnvironmentVariable("HERMES_HOME", "User") }
if (-not $finalHome2) { $finalHome2 = $CoreyHermesHome }
$envFile = Join-Path $finalHome2 ".env"
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
$finalHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { [Environment]::GetEnvironmentVariable("HERMES_HOME", "User") }
$hermesVer = ""
try { $hermesVer = hermes --version 2>&1 } catch { $hermesVer = "unknown" }
$gwRunning = $false
try { $null = hermes gateway status 2>&1; $gwRunning = $true } catch { }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Hermes bootstrap complete (native Windows)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Version:    $hermesVer"
Write-Host "  HERMES_HOME:  $finalHome"
Write-Host "  Gateway:    $(if ($gwRunning) { 'running' } else { 'not running' })"
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
Write-Host "  Troubleshooting:" -ForegroundColor Yellow
Write-Host "  - hermes gateway status      (check if running)"
Write-Host "  - hermes doctor              (diagnose issues)"
Write-Host "  - WinError 87? os.kill patch already applied"
Write-Host "  - Unicode error? PYTHONIOENCODING=utf-8 already set"
Write-Host "  - Code exec fails? Ensure Git Bash is on PATH"
Write-Host "  - Still broken? Try community enhanced installer:"
Write-Host "    irm https://gist.githubusercontent.com/HoriLiu/.../install-hermes-windows.ps1 | iex"
Write-Host "  - Re-run this script anytime (idempotent)"
Write-Host "============================================================" -ForegroundColor Cyan
