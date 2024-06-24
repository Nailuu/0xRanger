# 0xRanger
Automatic script that update a liquidity position of a Uniswap V3 LP when out of range to maximize APR and also collect and add fees to the position 

## Usage

1. Install package dependencies
```typescript
npm install --force
```

2. Install PM2 to run process as a daemon
```typescript
npm install pm2 -g
```

3. Run
```typescript
./run.sh
```

To stop the bot
```typescript
pm2 kill
```