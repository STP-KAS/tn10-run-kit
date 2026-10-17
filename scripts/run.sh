#!/usr/bin/env bash
# Start fee reads + sender for a TN10 run (logs from launch, sends only from start_utc to HARD_STOP_UTC).
# Usage: RUN_ENV=./config.env ./run.sh   (needs an explicit GO; nothing here runs on its own)
set -euo pipefail
: "${RUN_ENV:?set RUN_ENV to your config.env (copy config.example.env)}"
set -a; . "$RUN_ENV"; set +a
: "${RUN_DIR:?}" "${HARD_STOP_UTC:?}" "${KASPA_SDK:?}" "${TIPS_FILE:?}" "${NODES:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$RUN_DIR/logs"; cd "$RUN_DIR"
[ -e STOP ] && { echo "STOP present, refusing"; exit 1; }
nohup node "$HERE/fee-reads.mjs" >> logs/fee-reads.out 2>&1 &
SAT_LIVE=1 nohup node "$HERE/run-sender.mjs" --live >> logs/sender.out 2>&1 &
echo "started fee-reads and sender; kill switch: touch \$RUN_DIR/STOP"
