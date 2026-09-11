#!/bin/bash
set -a
source /root/task08-bridge/.env.signer1
set +a
exec node /root/task08-bridge/relayer/relayer.js
