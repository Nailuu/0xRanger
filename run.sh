#!/bin/bash
pm2 flush
pm2 start 'npx hardhat run scripts/bot.ts --network arbitrum' --no-autorestart