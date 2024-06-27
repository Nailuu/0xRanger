#!/usr/bin/env bash
PATH=`echo $PATH`

PATH_TO_FOLDER="/home/nailu/Solidity/0xRanger"

export $(xargs < $PATH_TO_FOLDER/.env.discord)

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

if [ "$TOKEN_ID" != "" ]
then
  newline;
  echo -n $POOL_LINK >> .webhook.tmp;
fi

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
curl -X PATCH -H "Content-Type: application/json" -d @.webhook.tmp $WEBHOOK_URL > /dev/null;