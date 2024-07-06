#!/usr/bin/env bash

# CHANGE PATH (paste = echo $PATH) AND PATH_TO_FOLDER to absolute path to 0xRanger folder
PATH=""
PATH_TO_FOLDER=""

export $(xargs < $PATH_TO_FOLDER/.env.discord)

# USED FOR VOLUME LINK
POOL_ADDRESS="0xC6962004f452bE9203591991D15f6b388e09E8D0"

ETH_GAS_PRICE_URL=https://arb-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY
ETH_GAS_PRICE_RESULT="`curl --request POST \
                     --url $ETH_GAS_PRICE_URL \
                     --header 'accept: application/json' \
                     --header 'content-type: application/json' \
                     --data '{"id": 1,"jsonrpc": "2.0","method": "eth_gasPrice"}' \
                     | jq -r '.result'`"


ETH_GAS_PRICE_WEI="`echo $[$ETH_GAS_PRICE_RESULT]`"

# pip install numpy
ETH_GAS_PRICE_GWEI="`python3 gwei.py $ETH_GAS_PRICE_WEI`"

# WEBHOOK INFOS
WEBHOOK_TOKEN="`printenv WEBHOOK_TOKEN`"
WEBHOOK_ID="`printenv WEBHOOK_ID`"
WEBHOOK_MESSAGE_ID="`printenv WEBHOOK_MESSAGE_ID`"
WEBHOOK_URL="https://discord.com/api/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN/messages/$WEBHOOK_MESSAGE_ID"

# BODY
DATE_TIME="`date "+%d/%m/%Y %H:%M:%S"`"
STATUS="`pm2 ls | grep online | wc -l`"
TOKEN_ID="`cat $PATH_TO_FOLDER/.token_id`"
POOL_LINK="<https://app.uniswap.org/pool/$TOKEN_ID?chain=arbitrum>"

if [ "$STATUS" = "0" ]
then
        STATUS="❌ OFFLINE ❌"
else
        STATUS="✅ ONLINE ✅"
fi

discord_dev() {
        echo -n "\`\`\`" >> .webhook.tmp;
}

newline() {
        echo -n "\n" >> .webhook.tmp;
}


echo -n "{\"content\":\"" > .webhook.tmp;

echo -n "### PM2 Status\n" >> .webhook.tmp;
discord_dev;
echo -n $DATE_TIME >> .webhook.tmp;
echo -n " - " >> .webhook.tmp;
echo -n $STATUS >> .webhook.tmp;
discord_dev;

discord_dev;
echo -n "⛽ Gas Price Tracker: " >> .webhook.tmp;
echo -n $ETH_GAS_PRICE_GWEI >> .webhook.tmp
echo -n " Gwei" >> .webhook.tmp
discord_dev;

if [ "$TOKEN_ID" != "" ]
then
  newline;
  echo -n $POOL_LINK >> .webhook.tmp;
fi

newline;
echo -n "<https://app.uniswap.org/explore/pools/arbitrum/$POOL_ADDRESS>" >> .webhook.tmp

STATUS="`pm2 ls | grep online | wc -l`"
if [ "$STATUS" != "0" ]
then
  newline;
  discord_dev;
  # replace strange restart character with r
  pm2 ls | sed 's/$/\\n/' | tr -d '\n' | sed -r 's/[↺]+/r/g' >> .webhook.tmp
  discord_dev;
fi

echo -n "\"}" >> .webhook.tmp;

# SEND POST REQUEST TO WEBHOOK
curl -X PATCH -H "Content-Type: application/json" -d @.webhook.tmp $WEBHOOK_URL;