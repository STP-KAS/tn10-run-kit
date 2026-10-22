<#
  Status of our TN10 node: process, sync, peers, disk, RAM, last log lines.
  Asks the node over its local wRPC JSON port (127.0.0.1:18210). No admin needed.
  UNTESTED DRAFT - check on first run.
#>
[CmdletBinding()]
param([int]$LogLines = 15)

# First line of every report: which machine, and when (UTC).
"HOST: $env:COMPUTERNAME  UTC: $((Get-Date).ToUniversalTime().ToString('u'))"

$Root    = 'C:\kaspa'
$DataDir = Join-Path $Root 'data-tn10'
$LogDir  = Join-Path $Root 'logs'
# Prefer the paths the running kaspad was actually started with (--appdir / --logdir).
$cmd = (Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1).CommandLine
if ($cmd -match '--appdir[= ]"?([^" ]+)') { $DataDir = $Matches[1] }
if ($cmd -match '--logdir[= ]"?([^" ]+)') { $LogDir  = $Matches[1] }
$LogFile = Join-Path $LogDir 'rusty-kaspa.log'
$ErrFile = Join-Path $LogDir 'rusty-kaspa_err.log'
$WsUrl   = 'ws://127.0.0.1:18210'

function Invoke-KaspaRpc([string]$Method) {
    # One request per connection keeps this simple. Returns the "params" object of the reply.
    $ws  = New-Object System.Net.WebSockets.ClientWebSocket
    $cts = New-Object System.Threading.CancellationTokenSource 10000
    try {
        $ws.ConnectAsync([Uri]$WsUrl, $cts.Token).Wait()
        $req = [Text.Encoding]::UTF8.GetBytes((@{ id = 1; method = $Method; params = @{} } | ConvertTo-Json -Compress))
        $ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList (, $req)), 'Text', $true, $cts.Token).Wait()
        $buf = New-Object byte[] 65536
        $ms  = New-Object IO.MemoryStream
        do {
            $r = $ws.ReceiveAsync((New-Object ArraySegment[byte] -ArgumentList (, $buf)), $cts.Token).Result
            $ms.Write($buf, 0, $r.Count)
        } until ($r.EndOfMessage)
        $reply = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
        if ($reply.error) { throw "RPC $Method error: $($reply.error | ConvertTo-Json -Compress)" }
        return $reply.params
    } finally {
        $ws.Dispose(); $cts.Dispose()
    }
}

Write-Host "=== TN10 node check $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -ForegroundColor Cyan

# Process and scheduled task
$task = Get-ScheduledTask -TaskName 'TN10 kaspad' -ErrorAction SilentlyContinue
Write-Host ("Task 'TN10 kaspad': " + $(if ($task) { $task.State } else { 'NOT INSTALLED' }))
$proc = Get-Process -Name kaspad -ErrorAction SilentlyContinue
if ($proc) {
    $up = (Get-Date) - $proc.StartTime
    Write-Host ("kaspad: running, PID {0}, up {1:%d}d {1:hh}h {1:mm}m, RAM {2:N1} GB" -f $proc.Id, $up, ($proc.WorkingSet64 / 1GB)) -ForegroundColor Green
} else {
    Write-Host 'kaspad: NOT RUNNING' -ForegroundColor Red
}

# Sync status over wRPC JSON
if ($proc) {
    try {
        $si   = Invoke-KaspaRpc 'getServerInfo'
        $dag  = Invoke-KaspaRpc 'getBlockDagInfo'
        $peer = Invoke-KaspaRpc 'getConnectedPeerInfo'
        $peers = @($peer.peerInfo | Where-Object { $_ }).Count
        $color = if ($si.isSynced) { 'Green' } else { 'Yellow' }
        Write-Host ("Network {0}, kaspad {1}, utxoindex {2}" -f $si.networkId, $si.serverVersion, $si.hasUtxoIndex)
        Write-Host ("Synced: {0}" -f $si.isSynced) -ForegroundColor $color
        Write-Host ("Headers {0}, blocks {1}, DAA score {2}, peers {3}" -f $dag.headerCount, $dag.blockCount, $si.virtualDaaScore, $peers)
        Write-Host ("Sink (tip) {0}  at UTC {1}" -f $dag.sink, (Get-Date).ToUniversalTime().ToString('HH:mm:ss'))
        $tipAge = (Get-Date).ToUniversalTime() - [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$dag.pastMedianTime).UtcDateTime
        Write-Host ("Past median time is {0:N0} min behind now (a few seconds when synced)" -f $tipAge.TotalMinutes)
    } catch {
        Write-Warning "No answer on $WsUrl yet (normal in the first minute after start): $($_.Exception.Message)"
    }
}

# Disk
$disk = Get-PSDrive -Name C
$freeGB = $disk.Free / 1GB
$dataGB = 0
if (Test-Path $DataDir) {
    $dataGB = (Get-ChildItem $DataDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB
}
Write-Host ("Disk C: {0:N0} GB free, node data {1:N1} GB" -f $freeGB, $dataGB)
if ($freeGB -lt 50) { Write-Warning ("Less than 50 GB free on C: ({0:N0} GB). Free up space before the node fills the disk." -f $freeGB) }

# RAM of the whole PC
$os = Get-CimInstance Win32_OperatingSystem
$totalGB = $os.TotalVisibleMemorySize / 1MB
$usedGB  = $totalGB - ($os.FreePhysicalMemory / 1MB)
Write-Host ("RAM: {0:N1} of {1:N1} GB in use" -f $usedGB, $totalGB)

# Logs
if (Test-Path $LogFile) {
    Write-Host "--- last $LogLines lines of $LogFile ---" -ForegroundColor Cyan
    Get-Content $LogFile -Tail $LogLines
} else {
    Write-Host "No log yet at $LogFile"
}
if ((Test-Path $ErrFile) -and (Get-Item $ErrFile).Length -gt 0) {
    Write-Host "--- last 5 lines of $ErrFile ---" -ForegroundColor Yellow
    Get-Content $ErrFile -Tail 5
}
