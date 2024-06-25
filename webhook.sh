#!/usr/bin/env bash
PATH=`echo $PATH`

# WEBHOOK INFOS
WEBHOOK_TOKEN="snrjxXV01Mkrd1wCHa59pciTm3SQe42FH-r5IcXf7NGfQIyrfcvXKOqiha6et-BmaB_7"
WEBHOOK_ID="1254881325568098344"
WEBHOOK_MESSAGE_ID="1254887196683665420"
WEBHOOK_URL="https://discord.com/api/webhooks/$WEBHOOK_ID/$WEBHOOK_TOKEN/messages/$WEBHOOK_MESSAGE_ID"

# BODY
DATE_TIME="`date "+%d/%m/%Y %H:%M:%S"`"
STATUS="`pm2 ls | grep online | wc -l`"
TOKEN_ID="`cat .token_id`"
POOL_LINK="<https://app.uniswap.org/pool/$TOKEN_ID?chain=arbitrum>"

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
discord_dev;
newline;
echo -n $POOL_LINK >> .webhook.tmp;
newline;
discord_dev;
# replace strange restart character with r
pm2 ls | sed 's/$/\\n/' | tr -d '\n' | sed -r 's/[↺]+/r/g' >> .webhook.tmp
discord_dev;

echo -n "\"}" >> .webhook.tmp;

# SEND POST REQUEST TO WEBHOOK
curl -X PATCH -H "Content-Type: application/json" -d @.webhook.tmp $WEBHOOK_URL > /dev/null;