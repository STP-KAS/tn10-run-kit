#Requires -RunAsAdministrator
<#
  Stops our TN10 node. Start it again with:  Start-ScheduledTask -TaskName 'TN10 kaspad'
  (or just reboot). UNTESTED DRAFT - check on first run.

  Windows has no clean way to send Ctrl+C to a hidden process, so kaspad is ended hard.
  Its database (RocksDB) is built to recover from that, but stop the node only when needed.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'TN10 kaspad'

New-Item -ItemType File -Force -Path 'C:\kaspa\STOP' | Out-Null   # tells run-kaspad.ps1 not to restart
Get-Process -Name kaspad -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (Get-Process -Name kaspad -ErrorAction SilentlyContinue) {
    Write-Warning 'kaspad is still running.'
} else {
    Write-Host 'kaspad stopped. It starts again at the next boot, or with:'
    Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
}
