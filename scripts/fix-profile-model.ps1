<#
.SYNOPSIS
  Fix Hermes profiles seeded with an empty `{}` config (Windows).
.DESCRIPTION
  Symptom: sending a message to an expert/agent 400s with
    "The supported API model names are ... but you passed ."
  Cause:  profiles under %USERPROFILE%\.hermes\profiles\<name>\config.yaml
          were created with the `{}` sentinel, so they carry no `model:`
          section and Hermes POSTs an empty model name.
  Fix:    copy the `model:` section from the root config.yaml into every
          profile that is still the `{}` sentinel, then restart Corey.
.USAGE
  powershell -ExecutionPolicy Bypass -File .\scripts\fix-profile-model.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "[+] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }

$hermesDir = if ($env:COREY_HERMES_DIR) { $env:COREY_HERMES_DIR } else { Join-Path $env:USERPROFILE '.hermes' }
$rootCfg = Join-Path $hermesDir 'config.yaml'
$profilesDir = Join-Path $hermesDir 'profiles'

Write-Host "=== Hermes profile model backfill ===" -ForegroundColor Cyan
Info "hermes dir : $hermesDir"

if (-not (Test-Path $rootCfg)) {
    Warn "root config not found: $rootCfg - nothing to inherit. Aborting."
    exit 1
}

# Extract the top-level `model:` block (header line + indented children).
$lines = Get-Content -LiteralPath $rootCfg
$model = New-Object System.Collections.Generic.List[string]
$inModel = $false
foreach ($line in $lines) {
    if ($line -match '^model:') { $inModel = $true; $model.Add($line); continue }
    if ($inModel) {
        if ($line -match '^\S') { break }   # next top-level key ends the block
        $model.Add($line)
    }
}
if (-not ($model -join "`n" | Select-String 'default:')) {
    Warn "no 'model:' section with a 'default:' in $rootCfg. Aborting."
    exit 1
}

Info "inheriting model section:"
$model | ForEach-Object { Write-Host "      $_" }

if (-not (Test-Path $profilesDir)) {
    Info "no profiles dir at $profilesDir - nothing to repair."
    exit 0
}

$seed = "# Hermes profile - managed by Corey`n" + ($model -join "`n") + "`n"
# The model block indented one level, to splice in over an empty scalar.
$modelMap = ($model -join "`n")
$n = 0
foreach ($dir in Get-ChildItem -LiteralPath $profilesDir -Directory) {
    $cfg = Join-Path $dir.FullName 'config.yaml'
    if (-not (Test-Path $cfg)) { continue }

    $raw = Get-Content -LiteralPath $cfg -Raw
    $nonEmpty = ($raw -split "`n" | Where-Object { $_ -match '\S' }) -join "`n"

    # Shape 1: the bare `{}` sentinel (never used yet) - seed the whole file.
    if ($nonEmpty -eq '{}') {
        Set-Content -LiteralPath $cfg -Value $seed -NoNewline -Encoding utf8
        Write-Host "    repaired ({} sentinel): $($dir.Name)"
        $n++
        continue
    }

    # Shape 2: a full config Hermes expanded on first use, left with an
    # EMPTY string model. Replace ONLY that line, preserving other keys.
    if ($raw -match "(?m)^model:\s*(''|"""")\s*$") {
        $fixed = [regex]::Replace($raw, "(?m)^model:\s*(''|"""")\s*$", $modelMap)
        Set-Content -LiteralPath $cfg -Value $fixed -NoNewline -Encoding utf8
        Write-Host "    repaired (empty model): $($dir.Name)"
        $n++
    }
}

Info "repaired $n profile(s)."
Info "Now fully quit and reopen Corey (or click the gateway Restart button)."
Write-Host "`nPress any key to close..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
