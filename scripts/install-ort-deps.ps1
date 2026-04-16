# install-ort-deps.ps1
# Installs all package manager tools required by Inspector Pika's ORT analyzer.
# Must be run from an elevated (Administrator) PowerShell prompt.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-ort-deps.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Elevation check ───────────────────────────────────────────────────────────
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell and choose 'Run as administrator'."
    exit 1
}

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Skip($msg) { Write-Host "    SKIP: $msg (already installed)" -ForegroundColor DarkGray }

# Reload PATH from system and user environment (call after choco installs)
function Reload-Path {
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';'
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')    -split ';'
    $env:Path = ($machine + $user | Where-Object { $_ }) -join ';'
}

# ── 1. Chocolatey packages ────────────────────────────────────────────────────
# Use --force so that packages previously downloaded but never fully installed
# (e.g. ruby.install where the RubyInstaller .exe was never actually run) get
# their install scripts executed.
$chocoPackages = @(
    @{ name = 'sbt';      desc = 'SBT (Scala)' },
    @{ name = 'ruby';     desc = 'Ruby (for Bundler)' },
    @{ name = 'php';      desc = 'PHP (for Composer)' },
    @{ name = 'composer'; desc = 'Composer (PHP)' },
    @{ name = 'elixir';   desc = 'Elixir + Mix' }
)

Step "Installing Chocolatey packages (--force ensures installer runs even if already registered)"
foreach ($pkg in $chocoPackages) {
    Write-Host "    Installing $($pkg.desc)..." -ForegroundColor Yellow
    choco install $pkg.name --force -y --no-progress
    Ok $pkg.desc
}

# Reload PATH so newly installed tools are visible in this session
Reload-Path

# ── 2. Ruby gem: bundler ──────────────────────────────────────────────────────
Step "Installing Ruby gem: bundler"

# gem.cmd may be in a non-standard path; search C:\tools\Ruby*\bin and C:\Ruby*\bin
$gemCmd = Get-Command gem -ErrorAction SilentlyContinue
if (-not $gemCmd) {
    $gemCmd = Get-ChildItem 'C:\tools', 'C:\' -Filter 'Ruby*' -Directory -ErrorAction SilentlyContinue |
              ForEach-Object { Join-Path $_.FullName 'bin\gem.cmd' } |
              Where-Object { Test-Path $_ } |
              Select-Object -First 1
    if ($gemCmd) {
        Write-Host "    Found gem at: $gemCmd" -ForegroundColor DarkGray
    }
}

if (-not $gemCmd) {
    Write-Host "    WARNING: gem not found on PATH or in common Ruby locations. Skipping bundler." -ForegroundColor Yellow
} else {
    $gemExe = if ($gemCmd -is [string]) { $gemCmd } else { $gemCmd.Source }
    & $gemExe install bundler --no-document
    Ok "bundler"
}

Reload-Path

# ── 3. pip packages: pipenv, poetry ──────────────────────────────────────────
Step "Installing pip packages: pipenv, poetry"

foreach ($pkg in @('pipenv', 'poetry')) {
    $installed = & pip show $pkg 2>$null
    if ($installed) {
        Skip $pkg
    } else {
        Write-Host "    Installing $pkg..." -ForegroundColor Yellow
        pip install $pkg
        Ok $pkg
    }
}

Reload-Path

# ── 4. Verification ───────────────────────────────────────────────────────────
Step "Verifying installs"
$tools = @(
    @{ cmd = 'sbt';      label = 'SBT' },
    @{ cmd = 'ruby';     label = 'Ruby' },
    @{ cmd = 'bundler';  label = 'Bundler' },
    @{ cmd = 'php';      label = 'PHP' },
    @{ cmd = 'composer'; label = 'Composer' },
    @{ cmd = 'elixir';   label = 'Elixir' },
    @{ cmd = 'mix';      label = 'Mix' },
    @{ cmd = 'pipenv';   label = 'pipenv' },
    @{ cmd = 'poetry';   label = 'Poetry' }
)

$allOk = $true
foreach ($t in $tools) {
    if (Get-Command $t.cmd -ErrorAction SilentlyContinue) {
        Ok "$($t.label) found at: $((Get-Command $t.cmd).Source)"
    } else {
        Write-Host "    MISSING: $($t.label) ($($t.cmd) not on PATH)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "All tools installed successfully." -ForegroundColor Green
    Write-Host "You may need to open a new terminal for PATH changes to take effect."
} else {
    Write-Host "Some tools are missing - see above. Open a new terminal and re-run to retry." -ForegroundColor Yellow
}
