# Our TN10 node on the mini PC

Setup for our own always-on Kaspa Testnet-10 node on the dedicated mini PC
(Beelink SER5 Pro, Ryzen 5 5500U, 16 GB RAM, 480 GB SSD, Windows 11 Pro).

> **Untested draft.** These scripts were written without a Windows machine to try them on.
> Check each step on the first run and fix what breaks.

## Files

| File | What it does |
|---|---|
| `install-node.ps1` | Run once as admin. Downloads rusty-kaspa 2.1.0 (win64) from the official GitHub release, checks its SHA256, installs to `C:\kaspa\2.1.0`, creates the task `TN10 kaspad`, sets the power plan to never sleep. |
| `run-kaspad.ps1` | Started by the task at every boot. Runs kaspad and restarts it if it exits. |
| `check-node.ps1` | Shows whether kaspad runs, sync status, peers, disk free, RAM use and the last log lines. |
| `stop-node.ps1` | Stops the node (it starts again at the next boot). |

Folders on the mini PC:

- `C:\kaspa\2.1.0`: kaspad.exe, kaspa-wallet.exe, rothschild.exe, stratum-bridge.exe
- `C:\kaspa\data-tn10`: node data (kaspad `--appdir`)
- `C:\kaspa\logs`: `rusty-kaspa.log`, `rusty-kaspa_err.log`, `run-kaspad.log`

## Steps

1. Plug in a screen (HDMI), USB keyboard and mouse. Finish the Windows first-start setup
   and connect the network (cable is better than Wi-Fi for a 24/7 node).
2. Copy this repo to the mini PC, for example to `C:\Users\Fermi\tn10-run-kit`.
3. Open PowerShell **as administrator** (Start, type PowerShell, right-click, Run as administrator):

   ```powershell
   cd C:\Users\Fermi\tn10-run-kit\node
   Set-ExecutionPolicy -Scope Process Bypass
   .\install-node.ps1
   ```

   The script stops if the download's SHA256 does not match the published one.
4. Wait for the sync. How long it takes is unknown until we try; expect several hours.
   Run `.\check-node.ps1` now and then. It is done when it shows `Synced: True`
   and the past median time is only seconds behind.
5. Turn on Remote Desktop (Settings > System > Remote Desktop), note the PC name,
   and test it from the desk PC. Then unplug screen, keyboard and mouse.
   From then on, use Remote Desktop to run `check-node.ps1`.

## Settings

- Network: `--testnet --netsuffix=10`, with `--utxoindex` (needed for wallets and our sender).
- RPC listens on this PC only: gRPC 16210 (miners, stratum-bridge), wRPC Borsh 17210 (Kaspa SDK),
  wRPC JSON 18210 (used by `check-node.ps1`). A miner on another PC reaches the node
  through a tunnel, not an open port.
- P2P port 16211: outbound only by default, which is enough to sync. `.\install-node.ps1 -OpenP2P`
  adds a Windows Firewall inbound rule for TCP 16211. We don't need it.
- No `--ram-scale`. The default fits 16 GB. Our 25 Sep crash came from `--ram-scale=0.1`;
  don't set it below the default.
- The task runs as SYSTEM, starts at boot without anyone logged in, has no time limit,
  and Task Scheduler retries every minute if it fails. The wrapper also restarts kaspad
  30 s after it exits.

## Disk and power

- Node data is about 90 GB. The 480 GB SSD is enough. `check-node.ps1` warns below 50 GB free.
- The install sets sleep, hibernate and disk timeout to "never" on mains power (`powercfg`).
- Windows Update restarts are not changed by the script. Set active hours
  (Settings > Windows Update > Advanced options) to cover our runs, and check for pending
  updates before a run. After a restart the node starts by itself and catches up.

## Stop, start, update

```powershell
.\stop-node.ps1                               # as admin
Start-ScheduledTask -TaskName 'TN10 kaspad'   # start again (or reboot)
```

Windows can't send a clean Ctrl+C to a hidden process, so `stop-node.ps1` ends kaspad hard.
The database is built to recover from that, but only stop the node when needed.

For a newer kaspad version: stop the node, change `$Version` and `$AssetSha256` in
`install-node.ps1` and the path in `run-kaspad.ps1`, then run the install again.
The data folder stays.

## Mining later

`stratum-bridge.exe` in `C:\kaspa\2.1.0` comes from the same zip. It's for connecting
miners to this node later. It is not set up here.
