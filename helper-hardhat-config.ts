// docs: https://discordjs.guide/#before-you-begin
// https://discord.js.org/docs/packages/discord.js/14.15.2
import { WebhookClient } from "discord.js";
import {
    GoogleSpreadsheet,
    GoogleSpreadsheetRow,
    GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { IWithdrawLogs } from "./interfaces/IWithdrawLogs";
import { IPoolConfig } from "./interfaces/IPoolConfig";
import JSBI from "jsbi";
import { MapWithLowerCaseKey } from "@uniswap/smart-order-router";
import { Ranger } from "./typechain-types";
import { TickMath, nearestUsableTick } from "@uniswap/v3-sdk";

const POOL = {
    ETH_MAINNET: {
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        FEE: 100,
    },
    ARBITRUM: {
        ADDRESS: "0xC6962004f452bE9203591991D15f6b388e09E8D0",
        WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        FEE: 500,
    },
};

const WHALE = {
    ETH_MAINNET: {
        DAI: "0xFd546293a729fE1A05D249Ad4F2CA984082F889e",
        USDC: "0x1bf0Aa215DAB195f21372105F53661e46F962ff3",
    },
    ARBITRUM: {
        WETH: "0x3368e17064C9BA5D6f1F93C4c678bea00cc78555",
        USDC: "0xD7a827FBaf38c98E8336C5658E4BcbCD20a4fd2d",
    },
};

// Return amount0 - slippage percent and amount1 - slippage percent
const getSlippageForAmmount = (
    slippagePercent: number,
    amount0: bigint,
    amount1: bigint,
): bigint[] => {
    const result0 = BigInt(Math.round(Number(amount0) * slippagePercent));
    const result1 = BigInt(Math.round(Number(amount1) * slippagePercent));

    return [result0, result1];
};

const DISCORD_WEBHOOK_URL_ERROR: string =
    process.env.DISCORD_WEBHOOK_URL_ERROR!;
const DISCORD_WEBHOOK_URL_WITHDRAW: string =
    process.env.DISCORD_WEBHOOK_URL_WITHDRAW!;
const DISCORD_WEBHOOK_URL_MINT: string = process.env.DISCORD_WEBHOOK_URL_MINT!;
const DISCORD_WEBHOOK_URL_SWAP: string = process.env.DISCORD_WEBHOOK_URL_SWAP!;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY!;

const getTokenInfoCoinGecko = async (
    address: string,
): Promise<{ price: number; symbol: string; decimals: number }> => {
    const headers: Headers = new Headers();

    headers.set("X-CG_DEMO_API_KEY", COINGECKO_API_KEY);
    headers.set("accept", "application/json");

    const request0: RequestInfo = new Request(
        `https://api.coingecko.com/api/v3/coins/arbitrum-one/contract/${address}`,
        {
            method: "GET",
            headers: headers,
        },
    );

    const response: Response = await fetch(request0);
    const body = await response.json();

    const symbol: string = (body.symbol as string).toUpperCase();
    const decimals: number = body.detail_platforms.ethereum.decimal_place;
    const price: number = body.market_data.current_price.usd;

    return { price, symbol, decimals };
};

const sendErrorLogsWebhook = async (
    functionName: string,
    error: Error,
): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_ERROR,
    });

    let header: string = "### " + functionName + "\n";
    let title: string = error.message + "\n";
    let errorStack: string = "```fix\n" + error.stack + "```";
    let tag: string = "\n<@&1246532969594748948>";

    await webhookClient.send({
        content: header + title + errorStack + tag,
    });
};

const sendWithdrawLogsWebhook = async (
    data: IWithdrawLogs,
    poolConfig: IPoolConfig,
): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_WITHDRAW,
    });

    const token0 = await getTokenInfoCoinGecko(poolConfig.token0);
    const token1 = await getTokenInfoCoinGecko(poolConfig.token1);

    const price_amount0 = (
        (Number(data.amount0) / 10 ** token0.decimals) *
        token0.price
    ).toFixed(4);
    const price_amount1 = (
        (Number(data.amount1) / 10 ** token1.decimals) *
        token1.price
    ).toFixed(4);

    const price_fee0 = (
        (Number(data.fee0) / 10 ** token0.decimals) *
        token0.price
    ).toFixed(4);
    const price_fee1 = (
        (Number(data.fee1) / 10 ** token1.decimals) *
        token1.price
    ).toFixed(4);

    let header: string =
        "### " + "Position was out of range and has been withdrawn\n";
    let content: string =
        "```fix\n" +
        "Amount collected:\n\n" +
        `${token0.symbol}: ${data.amount0} ($${price_amount0})\n` +
        `${token1.symbol}: ${data.amount1} ($${price_amount1})` +
        "\n\nFees collected:\n\n" +
        `${token0.symbol}: ${data.fee0} ($${price_fee0})\n` +
        `${token1.symbol}: ${data.fee1} ($${price_fee1})` +
        "```";

    await webhookClient.send({
        content: header + content,
    });
};

const sendMintLogsWebhook = async (): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_MINT,
    });

    let header: string =
        "### " + "Position was out of range and has been withdrawn\n";
    let content: string =
        "```fix\n" + `fee0: ${data.fee0}\nfee1: ${data.fee1}` + "```";

    await webhookClient.send({
        content: header + content,
    });
};

const sendSwapLogsWebhook = async (): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_SWAP,
    });

    let header: string =
        "### " + "Position was out of range and has been withdrawn\n";
    let content: string =
        "```fix\n" + `fee0: ${data.fee0}\nfee1: ${data.fee1}` + "```";

    await webhookClient.send({
        content: header + content,
    });
};

const sleep = (delay: any) =>
    new Promise((resolve) => setTimeout(resolve, delay));

const getTimestamp = () => {
    const now: Date = new Date(Date.now());
    return now.toLocaleString("fr-FR");
};

const sendWithdrawLogsGSheet = async (
    doc: GoogleSpreadsheet,
    data: IWithdrawLogs,
): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Withdraw DB"];

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: data.timestamp,
        tokenId: data.tokenId.toString(),
        gasUsed: data.gasUsed.toString(),
        tick: data.tick.toString(),
        lowerTick: data.lowerTick.toString(),
        upperTick: data.upperTick.toString(),
        amount0: data.amount0.toString(),
        amount1: data.amount1.toString(),
        fee0: data.fee0.toString(),
        fee1: data.fee1.toString(),
        b_amount0: data.b_amount0.toString(),
        b_amount1: data.b_amount1.toString(),
        a_amount0: data.a_amount0.toString(),
        a_amount1: data.a_amount1.toString(),
    });

    await row.save();

    console.log(`[${getTimestamp()}] - New withdraw row on GSheets addded`);
};

const getPriceOracle = async (contract: Ranger, pool: string, token0decimals: number, token1decimals: number): Promise<number> => {
    const sqrtPriceX96: bigint = await contract.getSqrtTwapX96(pool, 60);
    const Q96: number = 2 ** 96;

    const price: number = ((Number(sqrtPriceX96) / Q96) ** 2) / (10 ** token0decimals / 10 ** token1decimals);

    return (price);
}

const priceToSqrtPriceX96 = (price: number, token0decimals: number, token1decimals: number): number => {
    const Q96: number = 2 ** 96;

    const tmp: number = price * (10 ** token0decimals / 10 ** token1decimals);
    const result: number = Math.sqrt(tmp) * Q96;

    console.log(price);
    console.log(TickMath.getTickAtSqrtRatio(JSBI.BigInt(result)));

    return (result);
}

// def liquidityX(x, price, price_high):
// return x * math.sqrt(price) * math.sqrt(price_high) / (math.sqrt(price_high) - math.sqrt(price))

const getLiquidityX = (x: number, price: number, priceHigh: number): number => {
    const result: number =
        (x * Math.sqrt(price) * Math.sqrt(priceHigh)) /
        (Math.sqrt(priceHigh) - Math.sqrt(price));

    return result;
};

const getLiquidityY = (y: number, price: number, priceLow: number): number => {
    const result: number = y / (Math.sqrt(price) - Math.sqrt(priceLow));
        
    return result;
};

export {
    POOL,
    WHALE,
    getSlippageForAmmount,
    sendErrorLogsWebhook,
    sleep,
    getTimestamp,
    sendWithdrawLogsGSheet,
    sendWithdrawLogsWebhook,
    getTokenInfoCoinGecko,
    getPriceOracle,
    priceToSqrtPriceX96
};
