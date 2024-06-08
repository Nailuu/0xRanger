// docs: https://discordjs.guide/#before-you-begin
// https://discord.js.org/docs/packages/discord.js/14.15.2
import { WebhookClient } from "discord.js";
import {
    GoogleSpreadsheet,
    GoogleSpreadsheetRow,
    GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { IWithdrawLogs } from "./types/IWithdrawLogs";
import { IPoolConfig } from "./types/IPoolConfig";
import { Ranger } from "./typechain-types";
import { TickMath, nearestUsableTick } from "@uniswap/v3-sdk";
import { IPriceRangeInfo } from "./types/IPriceRangeInfo";
import { ContractTransactionReceipt, ContractTransactionResponse } from "ethers";
import { ISwapData } from "./types/ISwapData";
import { IPositionData } from "./types/IPositionData";
import JSBI from "jsbi";
import { ISwapLogs } from "./types/ISwapLogs";
import { IMintLogs } from "./types/IMintLogs";

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

const NFMP_ADDRESS: string = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

const DISCORD_WEBHOOK_URL_ERROR: string =
    process.env.DISCORD_WEBHOOK_URL_ERROR!;
const DISCORD_WEBHOOK_URL_WITHDRAW: string =
    process.env.DISCORD_WEBHOOK_URL_WITHDRAW!;
const DISCORD_WEBHOOK_URL_MINT: string = process.env.DISCORD_WEBHOOK_URL_MINT!;
const DISCORD_WEBHOOK_URL_SWAP: string = process.env.DISCORD_WEBHOOK_URL_SWAP!;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY!;

const getTokenInfoCoinGecko = async (address: string): Promise<{ price: number; symbol: string; decimals: number }> => {
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

// Return amount0 - slippage percent and amount1 - slippage percent
const getSlippageForAmount = (
    slippagePercent: number,
    amount0: bigint,
    amount1: bigint,
): bigint[] => {
    const result0 = BigInt(Math.floor(Number(amount0) * slippagePercent));
    const result1 = BigInt(Math.floor(Number(amount1) * slippagePercent));

    return [result0, result1];
};

const sendErrorLogsWebhook = async (
    functionName: string,
    error: Error,
): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_ERROR,
    });

    const header: string = "### " + functionName + "\n";
    const title: string = error.message + "\n";
    const errorStack: string = "```fix\n" + error.stack + "```";
    const tag: string = "\n<@&1246532969594748948>";

    await webhookClient.send({
        content: header + title + errorStack + tag,
    });
};

const sendWithdrawLogsWebhook = async (data: IWithdrawLogs, poolConfig: IPoolConfig): Promise<void> => {
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

    const header: string =
        "### " + "Position was out of range and has been withdrawn\n";
    const content: string =
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

const sendMintLogsWebhook = async (params: IMintLogs): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_MINT,
    });

    const header: string =
        "### " + "New position minted\n";
    const content: string =
        "```fix\n" +
        `Token ID: ${params.tokenId}\n\n` +
        `Lower Price: ${params.lowerPrice}\n` +
        `Price: ${params.price}\n` +
        `Upper Price: ${params.upperPrice}\n` +
        "```";

    await webhookClient.send({
        content: header + content,
    });
};

// doc, mintTimestamp, mintGasUsed, amount0ToMint, amount1ToMint, newPositionData, params
const sendMintLogsGSheet = async (doc: GoogleSpreadsheet, params: IMintLogs): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Mint DB"];

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: params.timestamp,
        tokenId: params.tokenId.toString(),
        gasUsed: params.gasUsed.toString(),
        lowerTick: params.lowerTick.toString(),
        upperTick: params.upperTick.toString(),
        amount0Mint: params.amount0ToMint.toString(),
        amount1Mint: params.amount1ToMint.toString(),
    });

    await row.save();
};

const sendSwapLogsWebhook = async (params: ISwapLogs): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_SWAP,
    });

    const token0: { price: number, symbol: string, decimals: number } = await getTokenInfoCoinGecko(params.token0);
    const token1: { price: number, symbol: string, decimals: number } = await getTokenInfoCoinGecko(params.token1);

    const header: string =
        "### " + `Swap from ${params.option ? "token1 to token0" : "token0 to token1"}\n`;
    const content: string =
        "```fix\n" +
        `Ratio0: ${params.ratio0}\n` +
        `Ratio1: ${params.ratio1}\n\n` +
        "Balance before swap:\n\n" +
        `${token0.symbol}: ${Number(params.b_amount0) / (10 ** Number(params.decimals0))}\n` +
        `${token1.symbol}: ${Number(params.b_amount1) / (10 ** Number(params.decimals1))}` +
        "\n\nBalance after swap:\n\n" +
        `${token0.symbol}: ${Number(params.a_amount0) / (10 ** Number(params.decimals0))}\n` +
        `${token1.symbol}: ${Number(params.a_amount1) / (10 ** Number(params.decimals1))}` +
        "```";

    await webhookClient.send({
        content: header + content,
    });
};

const sendSwapLogsGSheet = async (doc: GoogleSpreadsheet, params: ISwapLogs): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Swap DB"];

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: params.timestamp,
        gasUsed: params.gasUsed.toString(),
        "0to1": !params.option,
        "1to0": params.option,
        b_amount0: params.b_amount0.toString(),
        b_amount1: params.b_amount1.toString(),
        a_amount0: params.a_amount0.toString(),
        a_amount1: params.a_amount1.toString(),
        weight0: params.weight0.toString(),
        weight1: params.weight1.toString(),
        totalWeightInY: params.totalWeightInY.toString(),
        swap0: params.swap0.toString(),
        swap1: params.swap1.toString(),
        lowerTick: params.lowerTick.toString(),
        upperTick: params.upperTick.toString(),
        lowerPrice: params.lowerPrice.toString(),
        upperPrice: params.upperPrice.toString(),
        price: params.price.toString(),
        ratio0: params.ratio0.toString(),
        ratio1: params.ratio1.toString()
    });

    await row.save();
};

const sleep = (delay: number): Promise<unknown> =>
    new Promise((resolve) => setTimeout(resolve, delay));

const getTimestamp = (): string => {
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
};

const getPriceOracle = async (contract: Ranger, pool: string, decimals0: number, decimals1: number): Promise<number> => {
    const sqrtPriceX96: bigint = await contract.getSqrtTwapX96(pool, 60);
    const Q96: number = 2 ** 96;

    const price: number = ((Number(sqrtPriceX96) / Q96) ** 2) * (10 ** decimals0 / 10 ** decimals1);

    return (price);
};

const priceToSqrtPriceX96 = (price: number, token0decimals: number, token1decimals: number): number => {
    const Q96: number = 2 ** 96;

    const tmp: number = price / (10 ** token0decimals / 10 ** token1decimals);
    const result: number = Math.sqrt(tmp) * Q96;

    return (result);
};

const priceToNearestUsableTick = (price: number, token0decimals: number, token1decimals: number, tickSpacing: number): number => {
    const sqrtPriceX96: bigint = BigInt(priceToSqrtPriceX96(price, token0decimals, token1decimals));

    const tick: number = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96.toString()));

    const result: number = nearestUsableTick(tick, tickSpacing);

    return (result);
};

const tickToPrice = (tick: number, token0decimals: number, token1decimals: number): number => {
    return ((1.0001 ** tick) * ((10 ** token0decimals) / (10 ** token1decimals)));
};

const getTickSpacing = (fee: number): number => {
    if (fee == 500)
        return (10);
    else if (fee == 3000)
        return (60);
    else if (fee == 10000)
        return (200);
    else
        return (1);
};

// if percent = 2.5, then price range = price + 2.5% and price - 2.5% rounded with nearest usable tick
const priceToRange = async (contract: Ranger, pool: string, decimals0: number, decimals1: number, fee: number, lowerPercent: number, upperPercent: number): Promise<IPriceRangeInfo> => {
    const price: number = await getPriceOracle(contract, pool, decimals0, decimals1);

    let lowerPrice: number = price * (1 - lowerPercent / 100);
    let upperPrice: number = price * (1 + upperPercent / 100);

    const tickSpacing: number = getTickSpacing(fee);

    const lowerTick: number = priceToNearestUsableTick(lowerPrice, decimals0, decimals1, tickSpacing);
    const upperTick: number = priceToNearestUsableTick(upperPrice, decimals0, decimals1, tickSpacing);

    lowerPrice = tickToPrice(lowerTick, decimals0, decimals1);
    upperPrice = tickToPrice(upperTick, decimals0, decimals1);

    const ratio0: number = 0;
    const ratio1: number = 0;

    return { lowerTick, upperTick, lowerPrice, upperPrice, price, ratio0, ratio1 };
};

// x = token0 amount / 10 ** decimals, so 1 Eth = x = 1
const getLiquidityToken0 = (amount0: number, price: number, priceHigh: number): number => {
    return ((amount0 * Math.sqrt(price) * Math.sqrt(priceHigh)) / (Math.sqrt(priceHigh) - Math.sqrt(price)));
};

const getLiquidityToken1 = (amount1: number, price: number, priceLow: number): number => {
    return (amount1 / (Math.sqrt(price) - Math.sqrt(priceLow)));
};

const getAmountOfToken1ForLiquidity0 = (liquidity0: number, price: number, priceLow: number): number => {
    return (liquidity0 * (Math.sqrt(price) - Math.sqrt(priceLow)));
};

const getAmountOfToken0ForLiquidity1 = (liquidity1: number, price: number, priceHigh: number): number => {
    return (liquidity1 * (Math.sqrt(1 / price) - Math.sqrt(1 / priceHigh)));
};

const getAmountOfToken1ForToken0 = (amount0: number, decimals0: number, decimals1: number, params: IPriceRangeInfo): number => {
    const priceHigh: number = tickToPrice(params.upperTick, decimals0, decimals1);
    const priceLow: number = tickToPrice(params.lowerTick, decimals0, decimals1);

    const liquidity0: number = getLiquidityToken0(amount0, params.price, priceHigh);
    const amount1: number = getAmountOfToken1ForLiquidity0(liquidity0, params.price, priceLow);

    return (amount1 * (10 ** decimals1));
};

const getAmountOfToken0ForToken1 = (amount1: number, decimals0: number, decimals1: number, params: IPriceRangeInfo): number => {
    const priceHigh: number = tickToPrice(params.upperTick, decimals0, decimals1);
    const priceLow: number = tickToPrice(params.lowerTick, decimals0, decimals1);

    const liquidity1: number = getLiquidityToken1(amount1, params.price, priceLow);
    const amount0: number = getAmountOfToken0ForLiquidity1(liquidity1, params.price, priceHigh);

    return (amount0 * (10 ** decimals0));
};

const getRatioOfTokensAtPrice = (decimals0: number, decimals1: number, params: IPriceRangeInfo): void => {
    const amount1: number = getAmountOfToken1ForToken0(1, decimals0, decimals1, params) / (10 ** decimals1);

    params.ratio0 = (params.price / (params.price + amount1)) * 100;
    params.ratio1 = (amount1 / (params.price + amount1)) * 100;
};

const swapToken1ToToken0 = async (contract: Ranger, poolConfig: IPoolConfig, swap0: number, balance0: bigint, price: number, decimals0: number, decimals1: number): Promise<ISwapData> => {
    const amountIn: bigint = BigInt(Math.floor(((swap0 - Number(balance0)) / (10 ** decimals0) * price) * (10 ** decimals1)));
    const amountOutMinimum: bigint = BigInt(Math.floor((swap0 - Number(balance0)) * (1 - (0.5 / 100))));

    const swap: ContractTransactionResponse = await contract.swap(poolConfig.token1, poolConfig.token0, amountIn, amountOutMinimum);
    const timestamp: string = getTimestamp();
    const swapReceipt: ContractTransactionReceipt | null = await swap.wait(1);
    const gasUsed: bigint = swapReceipt!.gasUsed * swapReceipt!.gasPrice;

    return { timestamp, amountIn, gasUsed };
};

const swapToken0ToToken1 = async (contract: Ranger, poolConfig: IPoolConfig, swap1: number, balance1: bigint, price: number, decimals0: number, decimals1: number): Promise<ISwapData> => {
    const amountIn: bigint = BigInt(Math.floor((swap1 - Number(balance1)) / (10 ** decimals1) / price * (10 ** decimals0)));
    const amountOutMinimum: bigint = BigInt(Math.floor((swap1 - Number(balance1)) * (1 - (0.5 / 100))));

    const swap: ContractTransactionResponse = await contract.swap(poolConfig.token1, poolConfig.token0, amountIn, amountOutMinimum);
    const timestamp: string = getTimestamp();
    const swapReceipt: ContractTransactionReceipt | null = await swap.wait(1);
    const gasUsed: bigint = swapReceipt!.gasUsed * swapReceipt!.gasPrice;

    return { timestamp, amountIn, gasUsed };
};

export {
    POOL,
    WHALE,
    NFMP_ADDRESS,
    getSlippageForAmount,
    sendErrorLogsWebhook,
    sleep,
    getTimestamp,
    sendWithdrawLogsWebhook,
    sendWithdrawLogsGSheet,
    sendMintLogsWebhook,
    sendMintLogsGSheet,
    sendSwapLogsWebhook,
    sendSwapLogsGSheet,
    getTokenInfoCoinGecko,
    getPriceOracle,
    priceToSqrtPriceX96,
    priceToNearestUsableTick,
    priceToRange,
    getAmountOfToken0ForToken1,
    getAmountOfToken1ForToken0,
    tickToPrice,
    getRatioOfTokensAtPrice,
    swapToken1ToToken0,
    swapToken0ToToken1,
};
