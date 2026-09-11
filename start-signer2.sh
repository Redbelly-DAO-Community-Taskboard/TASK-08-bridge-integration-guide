#!/bin/bash
set -a
source /root/task08-bridge/.env.signer2
set +a
exec node /root/task08-bridge/relayer/relayer.js
