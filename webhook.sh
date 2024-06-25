#!/usr/bin/env bash
PATH=`echo $PATH`

# WEBHOOK INFOS
WEBHOOK_TOKEN=""
WEBHOOK_ID=""
WEBHOOK_MESSAGE_ID=""
WEBHOOK_URL="https://discord.com/api/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN/messages/$WEBHOOK_MESSAGE_ID"

# BODY
DATE_TIME="`date "+%d/%m/%Y %H:%M:%S"`"
STATUS="`pm2 ls | grep online | wc -l`"
TOKEN_ID="`cat .token_id`"
POOL_LINK="none"

if [ "$TOKEN_ID" != "cat: .token_id: No such file or directory" ]
then
  POOL_LINK="<https://app.uniswap.org/pool/$TOKEN_ID?chain=arbitrum>"
fi

if [ "$STATUS" == "0" ]
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
newline;
echo -n $POOL_LINK >> .webhook.tmp;
discord_dev;
newline;
discord_dev;
# replace strange restart character with r
pm2 ls | sed 's/$/\\n/' | tr -d '\n' | sed -r 's/[↺]+/r/g' >> .webhook.tmp
discord_dev;

echo -n "\"}" >> .webhook.tmp;

# SEND POST REQUEST TO WEBHOOK
curl -X PATCH -H "Content-Type: application/json" -d @.webhook.tmp $WEBHOOK_URL > /dev/null;