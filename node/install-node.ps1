#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time setup of our always-on TN10 (Kaspa Testnet-10) node on a dedicated Windows 11 mini PC.

.DESCRIPTION
  UNTESTED DRAFT - written without a Windows machine to test on. Check every step on first run.

  1. Downloads the official rusty-kaspa v2.1.0 win64 zip from GitHub and checks its SHA256.
  2. Extracts it to C:\kaspa\2.1.0 (kaspad.exe, kaspa-wallet.exe, rothschild.exe, stratum-bridge.exe).
  3. Copies run-kaspad.ps1 to C:\kaspa and creates the scheduled task 'TN10 kaspad'
     (starts at boot as SYSTEM, no time limit, restarts if it fails).
  4. Sets the power plan so the PC never sleeps or hibernates on mains power.
  5. Optional (-OpenP2P): Windows Firewall inbound rule for TCP 16211 (P2P). Off by default.

  Run from an elevated PowerShell, inside the node folder of the run kit:
    Set-ExecutionPolicy -Scope Process Bypass
    .\install-node.ps1
#>
[CmdletBinding()]
param(
    # Open TCP 16211 inbound for other TN10 peers. Not needed for syncing or mining.
    [switch]$OpenP2P,
    # Do not start the task right after installing.
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # makes Invoke-WebRequest much faster in Windows PowerShell 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Version    = '2.1.0'
$AssetName  = "rusty-kaspa-v$Version-win64.zip"
$AssetUrl   = "https://github.com/kaspanet/rusty-kaspa/releases/download/v$Version/$AssetName"
# SHA256 as published by GitHub for this release asset (API field "digest").
$AssetSha256 = 'fb25743a4b432d376c4ca49d8799769dbc6d5b070f0b502350ce32cfdb38ec0f'

$Root     = 'C:\kaspa'
$BinDir   = Join-Path $Root $Version
$DataDir  = Join-Path $Root 'data-tn10'
$LogDir   = Join-Path $Root 'logs'
$TaskName = 'TN10 kaspad'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# --- 1. Download and verify -------------------------------------------------
New-Item -ItemType Directory -Force -Path $Root, $DataDir, $LogDir | Out-Null
$zip = Join-Path $Root $AssetName

if (-not (Test-Path (Join-Path $BinDir 'kaspad.exe'))) {
    Write-Step "Downloading $AssetUrl"
    Invoke-WebRequest -Uri $AssetUrl -OutFile $zip -UseBasicParsing

    $hash = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    Write-Host "SHA256 of download: $hash"
    if ($hash -ne $AssetSha256) {
        Remove-Item $zip -Force
        throw "SHA256 mismatch. Expected $AssetSha256. Download deleted, nothing installed."
    }
    Write-Host 'SHA256 matches the hash GitHub publishes for this release asset.' -ForegroundColor Green

    # --- 2. Extract (the zip has the four .exe files at its top level) ----------
    Write-Step "Extracting to $BinDir"
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $BinDir -Force
    Remove-Item $zip -Force
} else {
    Write-Step "$BinDir\kaspad.exe already there, skipping download"
}

$kaspad = Join-Path $BinDir 'kaspad.exe'
if (-not (Test-Path $kaspad)) { throw "kaspad.exe not found in $BinDir" }
Unblock-File -Path (Join-Path $BinDir '*.exe')
Write-Host ("Installed: " + (& $kaspad --version))

# --- 3. Wrapper script and scheduled task ------------------------------------
Write-Step 'Copying run-kaspad.ps1 to C:\kaspa'
Copy-Item -Path (Join-Path $PSScriptRoot 'run-kaspad.ps1') -Destination (Join-Path $Root 'run-kaspad.ps1') -Force

Write-Step "Creating scheduled task '$TaskName'"
$psExe  = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $psExe `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Root\run-kaspad.ps1`"" `
    -WorkingDirectory $Root
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Our TN10 kaspad node (rusty-kaspa 2.1.0). Wrapper restarts kaspad if it exits.' | Out-Null

# --- 4. Power plan: never sleep on mains power -------------------------------
Write-Step 'Power plan: no sleep, no hibernate, no disk spin-down on AC'
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
# The screen may still turn off; that does not affect the node.

# --- 5. Optional firewall rule for P2P ----------------------------------------
$ruleName = 'TN10 kaspad P2P 16211'
if ($OpenP2P) {
    Write-Step "Firewall: allowing inbound TCP 16211 ($ruleName)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
            -LocalPort 16211 -Action Allow -Program $kaspad | Out-Null
    }
    Write-Host 'Peers from the internet also need a port forward on the router. Not required for our use.'
} else {
    Write-Host 'Firewall unchanged (no inbound P2P). The node still syncs through outbound connections.'
}

# --- Start ---------------------------------------------------------------------
if (-not $NoStart) {
    Write-Step "Starting '$TaskName'"
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 10
    if (Get-Process -Name kaspad -ErrorAction SilentlyContinue) {
        Write-Host 'kaspad is running.' -ForegroundColor Green
    } else {
        Write-Warning "kaspad is not running yet. Look at $LogDir\run-kaspad.log and $LogDir\rusty-kaspa_err.log"
    }
}

Write-Host ''
Write-Host 'Done. Next: run .\check-node.ps1 now and then every hour or so until it says synced.'
Write-Host 'Windows Update: set active hours (Settings > Windows Update > Advanced options) so it does'
Write-Host 'not restart during a run. The node comes back by itself after a restart.'
