<#
  Wrapper started by the scheduled task 'TN10 kaspad' (installed to C:\kaspa\run-kaspad.ps1).
  Runs kaspad and starts it again if it exits, until stop-node.ps1 creates C:\kaspa\STOP.
  UNTESTED DRAFT - check on first run.
#>
$ErrorActionPreference = 'Continue'

$Root    = 'C:\kaspa'
$Kaspad  = Join-Path $Root '2.1.0\kaspad.exe'
$DataDir = Join-Path $Root 'data-tn10'
$LogDir  = Join-Path $Root 'logs'
$Stop    = Join-Path $Root 'STOP'
$RunLog  = Join-Path $LogDir 'run-kaspad.log'

# Flags checked against 'kaspad --help' of v2.1.0.
# All RPC stays on localhost; a miner or bridge on another PC reaches it through a tunnel.
# No --ram-scale: the default is right for 16 GB. Our 25 Sep crash came from --ram-scale=0.1.
$KaspadArgs = @(
    '--testnet', '--netsuffix=10',
    '--utxoindex',
    "--appdir=$DataDir",
    "--logdir=$LogDir",
    '--rpclisten=127.0.0.1:16210',        # gRPC (miners, stratum-bridge)
    '--rpclisten-borsh=127.0.0.1:17210',  # wRPC Borsh (Kaspa SDK)
    '--rpclisten-json=127.0.0.1:18210',   # wRPC JSON (check-node.ps1)
    '--yes'                                # never wait for a console question
)

function Log($msg) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
    Add-Content -Path $RunLog -Value $line
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
# A start by boot or by Start-ScheduledTask means: we want the node running.
Remove-Item $Stop -ErrorAction SilentlyContinue

while ($true) {
    Log "starting kaspad $($KaspadArgs -join ' ')"
    # kaspad writes its own log to $LogDir\rusty-kaspa.log; console output is not needed.
    $p = Start-Process -FilePath $Kaspad -ArgumentList $KaspadArgs -WindowStyle Hidden -PassThru -Wait
    Log "kaspad exited with code $($p.ExitCode)"
    if (Test-Path $Stop) { Log 'STOP file found, not restarting'; break }
    Start-Sleep -Seconds 30
}
