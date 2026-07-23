#!/bin/bash
# One-shot V2 upgrade: upgrade the program, migrate legacy pools, restart the
# airdrop-aware keeper. Requires the deployer wallet funded above the buffer
# rent (~1.92 SOL). Run on the VM: bash /root/infinity/client/deploy-v2.sh
set -e
export PATH="$PATH:$HOME/.local/share/solana/install/active_release/bin"
: "${RPC:?set RPC to the mainnet endpoint}"
SO=/root/infinity/program/target/deploy/infinity_amm.so
PROG=MCSwDjn4iunErqx27dVatoFHASuKgKk25UA8wEZinfi

echo "== 1. upgrade program =="
solana program deploy "$SO" --program-id "$PROG" \
  --upgrade-authority "$HOME/.config/solana/id.json" -u "$RPC" --with-compute-unit-price 30000

echo "== 2. migrate live V1 pools =="
cd /root/infinity/client
RPC="$RPC" node migrate-pools.mjs

echo "== 3. restart airdrop-aware keeper =="
tmux send-keys -t cranker C-c 2>/dev/null || true
sleep 2
tmux send-keys -t cranker "RPC=\"$RPC\" POLL_MS=60000 node cranker.mjs >cranker.log 2>&1" Enter 2>/dev/null \
  || tmux new-session -d -s cranker "cd /root/infinity/client && RPC=\"$RPC\" POLL_MS=60000 node cranker.mjs >cranker.log 2>&1"

echo "== done: program upgraded, pools migrated, keeper live =="
