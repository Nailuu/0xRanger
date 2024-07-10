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
import { IERC20, IUniswapV3Pool, Ranger } from "./typechain-types";
import { TickMath, nearestUsableTick } from "@uniswap/v3-sdk";
import { IPriceRangeInfo } from "./types/IPriceRangeInfo";
import { ContractTransactionReceipt, ContractTransactionResponse, FeeData } from "ethers";
import { ISwapData } from "./types/ISwapData";
import JSBI from "jsbi";
import { ISwapLogs } from "./types/ISwapLogs";
import { IMintLogs } from "./types/IMintLogs";
import fs from "fs-extra";
import { ethers } from "hardhat";

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

const DISCORD_WEBHOOK_URL_ERROR: string | undefined = process.env.DISCORD_WEBHOOK_URL_ERROR;
const DISCORD_WEBHOOK_URL_WITHDRAW: string | undefined = process.env.DISCORD_WEBHOOK_URL_WITHDRAW;
const DISCORD_WEBHOOK_URL_MINT: string | undefined = process.env.DISCORD_WEBHOOK_URL_MINT;
const DISCORD_WEBHOOK_URL_SWAP: string | undefined = process.env.DISCORD_WEBHOOK_URL_SWAP;
const COINGECKO_API_KEY: string | undefined = process.env.COINGECKO_API_KEY;
const CONTRACT_ADDRESS: string | undefined = process.env.CONTRACT_ADDRESS;
const MAX_GAS_PRICE: string | undefined = process.env.MAX_GAS_PRICE;
const GAS_PRICE_CHECK_TIMEOUT: string | undefined = process.env.GAS_PRICE_CHECK_TIMEOUT;
const SWAP_SLIPPAGE_PERCENT: string | undefined = process.env.SWAP_SLIPPAGE_PERCENT;

const NFMP_ADDRESS: string = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

const checkProcessEnvConstants = (): void => {
    if (DISCORD_WEBHOOK_URL_ERROR == undefined || DISCORD_WEBHOOK_URL_WITHDRAW == undefined
        || DISCORD_WEBHOOK_URL_MINT == undefined || DISCORD_WEBHOOK_URL_SWAP == undefined) {
        throw new Error("One or more DISCORD_WEBHOOK_URL_??? are not defined");
    }

    if (COINGECKO_API_KEY == undefined) {
        throw new Error("COINGECKO_API_KEY is not defined");
    }

    if (CONTRACT_ADDRESS == undefined) {
        throw new Error("CONTRACT_ADDRESS is not defined");
    }

    if (GAS_PRICE_CHECK_TIMEOUT == undefined || MAX_GAS_PRICE == undefined) {
        throw new Error("GAS_PRICE_CHECK_TIMEOUT and MAX_GAS_PRICE are not defined");
    }

    if (SWAP_SLIPPAGE_PERCENT == undefined) {
        throw new Error("SWAP_SLIPPAGE_PERCENT is not defined")
    }
}

const checkGasPrice = async (): Promise<void> => {
    const data: FeeData =  await ethers.provider.getFeeData();
    if (data.gasPrice! >= BigInt(MAX_GAS_PRICE!)) {
        customLog(`[${getTimestamp()}] - Gas price too high (${data.gasPrice} Wei - ${Number(data.gasPrice) / 1e9} Gwei - Limit: ${Number(MAX_GAS_PRICE) / 1e9} Gwei), sleeping ${GAS_PRICE_CHECK_TIMEOUT} minutes...`);
        await sleep(Number(GAS_PRICE_CHECK_TIMEOUT!) * 60 * 1000);
        await checkGasPrice();
    }
}

const getTokenInfoCoinGecko = async (address: string): Promise<{ price: number; symbol: string; decimals: number }> => {
    const headers: Headers = new Headers();

    headers.set("X-CG_DEMO_API_KEY", COINGECKO_API_KEY!);
    headers.set("accept", "application/json");

    const request: RequestInfo = new Request(
        `https://api.coingecko.com/api/v3/coins/arbitrum-one/contract/${address}`,
        {
            method: "GET",
            headers: headers,
        },
    );

    const response: Response = await fetch(request);
    const body = await response.json();

    // add delay before retry when rate limited
    if (body?.status?.error_code == 429) {
        await sleep(10000);
        return (await getTokenInfoCoinGecko(address));
    }

    const symbol: string = (body.symbol as string).toUpperCase();
    const decimals: number = body.detail_platforms.ethereum.decimal_place;
    const price: number = body.market_data.current_price.usd;

    return { price, symbol, decimals };
};

const getEthereumPriceCoinGecko = async (): Promise<number> => {
    const headers: Headers = new Headers();

    headers.set("X-CG_DEMO_API_KEY", COINGECKO_API_KEY!);
    headers.set("accept", "application/json");

    const request: RequestInfo = new Request(
        `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`,
        {
            method: "GET",
            headers: headers,
        },
    );

    const response: Response = await fetch(request);
    const body = await response.json();

    // add delay before retry when rate limited
    if (body?.status?.error_code == 429) {
        await sleep(10000);
        return (await getEthereumPriceCoinGecko());
    }

    return (body?.ethereum?.usd);
}

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
        url: DISCORD_WEBHOOK_URL_ERROR!,
    });

    const header: string = "### " + functionName + "\n";
    const title: string = error.message + "\n";
    // truncate string if length > 1700 because discord webhook accept message only under 2000 characters
    const errorStack: string = "```fix\n" + (error.stack!.length > 1700 ? error.stack?.substring(0, 1700) : error.stack) + "```";
    const tag: string = "\n<@&1258587489367494689>";

    await webhookClient.send({
        content: header + title + errorStack + tag,
    });
};

const sendWithdrawLogsWebhook = async (data: IWithdrawLogs, poolConfig: IPoolConfig): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_WITHDRAW!,
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

const sendWithdrawLogsGSheet = async (
    doc: GoogleSpreadsheet,
    data: IWithdrawLogs,
    token0: IERC20,
    token1: IERC20,
): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Withdraw"];

    const eth_price: number = await getEthereumPriceCoinGecko();
    const gasUSD: number = Number(data.totalGasUsed) / 1e18 * eth_price;

    const cg_token0 = await getTokenInfoCoinGecko(await token0.getAddress());
    const cg_token1 = await getTokenInfoCoinGecko(await token1.getAddress());

    const price_amount0 = (
        (Number(data.amount0) / 10 ** cg_token0.decimals) *
        cg_token0.price
    ).toFixed(4);
    const price_amount1 = (
        (Number(data.amount1) / 10 ** cg_token1.decimals) *
        cg_token1.price
    ).toFixed(4);

    const price_fee0 = (
        (Number(data.fee0) / 10 ** cg_token0.decimals) *
        cg_token0.price
    ).toFixed(4);
    const price_fee1 = (
        (Number(data.fee1) / 10 ** cg_token1.decimals) *
        cg_token1.price
    ).toFixed(4);

    const balance0: bigint = await token0.balanceOf(CONTRACT_ADDRESS!);
    const balance1: bigint = await token1.balanceOf(CONTRACT_ADDRESS!);

    const usd_balance0 = (
        (Number(balance0) / 10 ** cg_token0.decimals) *
        cg_token0.price
    ).toFixed(4);
    const usd_balance1 = (
        (Number(balance1) / 10 ** cg_token1.decimals) *
        cg_token1.price
    ).toFixed(4);

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: data.timestamp,
        ethPrice: eth_price.toString(),
        tokenId: data.tokenId.toString(),
        totalGasUsed: data.totalGasUsed.toString(),
        gasUsed: data.gasUsed.toString(),
        gasPrice: data.gasPrice.toString(),
        gasUSD: gasUSD.toString(),
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
        usd_amount0: price_amount0.toString(),
        usd_amount1: price_amount1.toString(),
        usd_fee0: price_fee0.toString(),
        usd_fee1: price_fee1.toString(),
        usd_balance0: usd_balance0.toString(),
        usd_balance1: usd_balance1.toString(),
    });

    await row.save();
};

const sendMintLogsWebhook = async (params: IMintLogs): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_MINT!,
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
const sendMintLogsGSheet = async (doc: GoogleSpreadsheet, params: IMintLogs, token0: IERC20, token1: IERC20): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Mint"];

    const eth_price: number = await getEthereumPriceCoinGecko();
    const gasUSDMint: number = Number(params.totalGasUsedMint) / 1e18 * eth_price;
    const gasUSDApproval: number = Number(params.totalGasUsedApproval) / 1e18 * eth_price;

    const gc_token0 = await getTokenInfoCoinGecko(await token0.getAddress());
    const gc_token1 = await getTokenInfoCoinGecko(await token1.getAddress());

    const usd_amount0Mint = (
        (Number(params.amount0ToMint) / 10 ** gc_token0.decimals) *
        gc_token0.price
    )
    const usd_amount1Mint = (
        (Number(params.amount1ToMint) / 10 ** gc_token1.decimals) *
        gc_token1.price
    )

    const balance0: bigint = await token0.balanceOf(CONTRACT_ADDRESS!);
    const balance1: bigint = await token1.balanceOf(CONTRACT_ADDRESS!);

    const usd_balance0 = (
        (Number(balance0) / 10 ** gc_token0.decimals) *
        gc_token0.price
    )
    const usd_balance1 = (
        (Number(balance1) / 10 ** gc_token1.decimals) *
        gc_token1.price
    )

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: params.timestamp,
        ethPrice: eth_price.toString(),
        tokenId: params.tokenId.toString(),
        totalGasUsedMint: params.totalGasUsedMint.toString(),
        gasUsedMint: params.gasPriceMint.toString(),
        gasPriceMint: params.gasPriceMint.toString(),
        gasUSDMint: gasUSDMint.toString(),
        totalGasUsedApproval: params.totalGasUsedApproval.toString(),
        gasUsedApproval: params.gasUsedApproval.toString(),
        gasPriceApproval: params.gasPriceApproval.toString(),
        gasUSDApproval: gasUSDApproval.toString(),
        lowerTick: params.lowerTick.toString(),
        upperTick: params.upperTick.toString(),
        amount0Mint: params.amount0ToMint.toString(),
        amount1Mint: params.amount1ToMint.toString(),
        usd_balance_before: (usd_amount0Mint + usd_amount1Mint).toFixed(4),
        usd_balance_after: (usd_balance0 + usd_balance1).toFixed(4),
    });

    await row.save();
};

const sendSwapLogsWebhook = async (params: ISwapLogs): Promise<void> => {
    const webhookClient: WebhookClient = new WebhookClient({
        url: DISCORD_WEBHOOK_URL_SWAP!,
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

const sendSwapLogsGSheet = async (doc: GoogleSpreadsheet, params: ISwapLogs, poolConfig: IPoolConfig): Promise<void> => {
    // you have to share the gsheet to GOOGLE_CLIENT_EMAIL
    await doc.loadInfo();

    const sheet: GoogleSpreadsheetWorksheet = doc.sheetsByTitle["Swap"];

    const eth_price: number = await getEthereumPriceCoinGecko();
    const gasUSD: number = Number(params.totalGasUsed) / 1e18 * eth_price;

    const token0 = await getTokenInfoCoinGecko(poolConfig.token0);
    const token1 = await getTokenInfoCoinGecko(poolConfig.token1);

    const usd_b_amount0: string = (
        (Number(params.b_amount0) / 10 ** token0.decimals) *
        token0.price
    ).toFixed(4);
    const usd_b_amount1: string = (
        (Number(params.b_amount1) / 10 ** token1.decimals) *
        token1.price
    ).toFixed(4);
    const usd_a_amount0: string = (
        (Number(params.a_amount0) / 10 ** token0.decimals) *
        token0.price
    ).toFixed(4);
    const usd_a_amount1: string = (
        (Number(params.a_amount1) / 10 ** token1.decimals) *
        token1.price
    ).toFixed(4);

    const row: GoogleSpreadsheetRow = await sheet.addRow({
        timestamp: params.timestamp,
        ethPrice: eth_price.toString(),
        totalGasUsed: params.totalGasUsed.toString(),
        gasUsed: params.gasUsed.toString(),
        gasPrice: params.gasPrice.toString(),
        gasUSD: gasUSD.toString(),
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
        ratio1: params.ratio1.toString(),
        usd_b_amount0: usd_b_amount0,
        usd_b_amount1: usd_b_amount1,
        usd_a_amount0: usd_a_amount0,
        usd_a_amount1: usd_a_amount1,
        price_after_swap: params.priceAfterSwap.toString()
    });

    await row.save();
};

const sleep = (delay: number): Promise<unknown> =>
    new Promise((resolve) => setTimeout(resolve, delay));

const getTimestamp = (): string => {
    const now: Date = new Date(Date.now());
    return now.toLocaleString("en-US");
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

const swapToken1ToToken0 = async (contract: Ranger, poolConfig: IPoolConfig, info: IPriceRangeInfo, swap0: number, balance0: bigint, decimals0: number, decimals1: number): Promise<ISwapData> => {
    const amountIn: bigint = BigInt(Math.floor(((swap0 - Number(balance0)) / (10 ** decimals0) * info.price) * (10 ** decimals1)));
    const amountOutMinimum: bigint = BigInt(Math.floor((swap0 - Number(balance0)) * (1 - (Number(SWAP_SLIPPAGE_PERCENT!) / 100))));

    const swap: ContractTransactionResponse = await contract.swap(poolConfig.token1, poolConfig.token0, amountIn, amountOutMinimum);
    const timestamp: string = getTimestamp();
    const swapReceipt: ContractTransactionReceipt | null = await swap.wait(1);
    const totalGasUsed: bigint = swapReceipt!.gasUsed * swapReceipt!.gasPrice;

    const priceAfterSwap: number = await getPriceOracle(contract, poolConfig.pool, decimals0, decimals1);

    return { timestamp, amountIn, totalGasUsed, gasPrice: swapReceipt!.gasPrice, gasUsed: swapReceipt!.gasUsed, priceAfterSwap };
};

const swapToken0ToToken1 = async (contract: Ranger, poolConfig: IPoolConfig, info: IPriceRangeInfo, swap1: number, balance1: bigint, decimals0: number, decimals1: number): Promise<ISwapData> => {
    const amountIn: bigint = BigInt(Math.floor((swap1 - Number(balance1)) / (10 ** decimals1) / info.price * (10 ** decimals0)));
    const amountOutMinimum: bigint = BigInt(Math.floor((swap1 - Number(balance1)) * (1 - (Number(SWAP_SLIPPAGE_PERCENT!) / 100))));

    const swap: ContractTransactionResponse = await contract.swap(poolConfig.token0, poolConfig.token1, amountIn, amountOutMinimum);
    const timestamp: string = getTimestamp();
    const swapReceipt: ContractTransactionReceipt | null = await swap.wait(1);
    const totalGasUsed: bigint = swapReceipt!.gasUsed * swapReceipt!.gasPrice;

    const priceAfterSwap: number = await getPriceOracle(contract, poolConfig.pool, decimals0, decimals1);

    return { timestamp, amountIn, totalGasUsed, gasPrice: swapReceipt!.gasPrice, gasUsed: swapReceipt!.gasUsed, priceAfterSwap };
};

const customLog = (msg: string): void => {
    console.log(msg);
    fs.appendFile("logs.txt", msg + "\n");
};

const checkProtocolFee = async (pool: IUniswapV3Pool): Promise<void> => {
    const fees: {token0: bigint, token1: bigint} = await pool.protocolFees();

    if (fees.token0 != 0n || fees.token1 != 0n) {
        throw new Error(`Pool protocol fees was activated! (token0: ${fees.token0} - token1: ${fees.token1})`);
    }
}

export {
    POOL,
    WHALE,
    NFMP_ADDRESS,
    CONTRACT_ADDRESS,
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
    customLog,
    getEthereumPriceCoinGecko,
    checkGasPrice,
    checkProtocolFee,
    checkProcessEnvConstants
};
