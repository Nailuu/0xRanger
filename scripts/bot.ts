import { ethers, getNamedAccounts } from "hardhat";
import {
    getRatioOfTokensAtPrice, getSlippageForAmount,
    getTimestamp, priceToRange,
    sendErrorLogsWebhook, sendMintLogsGSheet, sendMintLogsWebhook, sendSwapLogsGSheet, sendSwapLogsWebhook,
    sendWithdrawLogsGSheet,
    sendWithdrawLogsWebhook,
    sleep, swapToken0ToToken1, swapToken1ToToken0, NFMP_ADDRESS, POOL, customLog, CONTRACT_ADDRESS,
} from "../helper-hardhat-config";
import { IPoolConfig } from "../types/IPoolConfig";
import {
    ContractTransactionResponse,
    ContractTransactionReceipt,
} from "ethers";
import {
    IERC20,
    INonfungiblePositionManager,
    IUniswapV3Pool,
    Ranger,
} from "../typechain-types";
import { IPositionData } from "../types/IPositionData";
import { ISlot0 } from "../types/ISlot0";
import { IAmounts } from "../types/IAmounts";
import { IWithdrawResult } from "../types/IWithdrawResult";
import { IWithdrawLogs } from "../types/IWithdrawLogs";
import { IPriceRangeInfo } from "../types/IPriceRangeInfo";
import { ISwapData } from "../types/ISwapData";
import { ISwapLogs } from "../types/ISwapLogs";
import { IMintLogs } from "../types/IMintLogs";
import fs from "fs-extra";

// docs: https://theoephraim.github.io/node-google-spreadsheet/#/
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const GOOGLE_CLIENT_EMAIL: string = process.env.GOOGLE_CLIENT_EMAIL!;
// replace \n character to real newline otherwise throw error
const GOOGLE_PRIVATE_KEY: string = process.env
    .GOOGLE_PRIVATE_KEY!.split(String.raw`\n`)
    .join("\n");
const SPREADSHEET_ID: string = process.env.SPREADSHEET_ID!;

const jwt: JWT = new JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: "https://www.googleapis.com/auth/spreadsheets",
});

const doc: GoogleSpreadsheet = new GoogleSpreadsheet(SPREADSHEET_ID, jwt);

const LOWER_RANGE_PERCENT: string | undefined = process.env.LOWER_RANGE_PERCENT;
const UPPER_RANGER_PERCENT: string | undefined = process.env.UPPER_RANGE_PERCENT;
const WITHDRAW_SLIPPAGE_PERCENTAGE: number = 0.1;

// minutes
const TICK_RANGE_CHECK_TIMEOUT: number = 5;

const bot = async (): Promise<void> => {
    const { deployer } = await getNamedAccounts();

    if (LOWER_RANGE_PERCENT == undefined || UPPER_RANGER_PERCENT == undefined) {
        customLog(`[${getTimestamp()}] - Upper and lower range percent are not defined`);
        throw new Error("Upper and lower range percent are not defined");
    }

    const deployer_balance: bigint = await ethers.provider.getBalance(deployer);
    if (deployer_balance <= BigInt(0.0003 * 1e18)) {
        customLog(`[${getTimestamp()}] - Owner balance is low, refill balance!`);
        throw new Error("Owner balance is low, refill balance!");
    }

    const contract: Ranger = await ethers.getContractAt(
        "Ranger",
        CONTRACT_ADDRESS,
    );

    const poolConfig: IPoolConfig = await contract.poolConfig();
    const positionData: IPositionData = await contract.positionData();

    const decimals0: number = Number(poolConfig.decimals0);
    const decimals1: number = Number(poolConfig.decimals1);

    const token0: IERC20 = await ethers.getContractAt(
        "IERC20",
        poolConfig.token0,
    );
    const token1: IERC20 = await ethers.getContractAt(
        "IERC20",
        poolConfig.token1,
    );

    const pool: IUniswapV3Pool = await ethers.getContractAt(
        "IUniswapV3Pool",
        poolConfig.pool,
    );

    for (;;) {
        if (!positionData.active) {
            customLog(`[${getTimestamp()}] - No active position`);
            break;
        }

        const slot0: ISlot0 = await pool.slot0();

        if (
            slot0.tick < positionData.tickLower ||
            slot0.tick > positionData.tickUpper
        ) {
            customLog(`[${getTimestamp()}] - Position out of range, withdrawing liquidity!`);

            const b_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
            const b_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

            const amounts: IAmounts = await contract.getAmountsForPosition(
                poolConfig.pool,
                positionData.liquidity,
                positionData.tickLower,
                positionData.tickUpper,
            );

            const amountsMin: bigint[] = getSlippageForAmount(1 - WITHDRAW_SLIPPAGE_PERCENTAGE / 100, amounts.amount0, amounts.amount1);

            // withdraw liquidity and collect fees
            const withdraw: ContractTransactionResponse = await contract.withdrawLiquidity(amountsMin[0], amountsMin[1]);

            const timestamp: string = getTimestamp();
            const withdrawReceipt: ContractTransactionReceipt | null = await withdraw.wait(1);
            const withdrawGasUsed: bigint = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

            const withdrawResult: IWithdrawResult = await contract.withdrawResult();

            const a_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
            const a_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

            const data: IWithdrawLogs = {
                timestamp: timestamp,
                tokenId: positionData.tokenId,
                gasUsed: withdrawGasUsed,
                tick: slot0.tick,
                lowerTick: positionData.tickLower,
                upperTick: positionData.tickUpper,
                amount0: withdrawResult.amount0,
                amount1: withdrawResult.amount1,
                fee0: withdrawResult.fee0,
                fee1: withdrawResult.fee1,
                b_amount0: b_amount0,
                b_amount1: b_amount1,
                a_amount0: a_amount0,
                a_amount1: a_amount1,
            };

            customLog(`[${timestamp}] - Position (Token ID: ${positionData.tokenId}) has been withdrawn`);

            // Discord Webhook
            await sendWithdrawLogsWebhook(data, poolConfig);
            // Google Sheets API
            await sendWithdrawLogsGSheet(doc, data, token0, token1);

            break;
        }

        customLog(`[${getTimestamp()}] - Position still in range, sleeping mode activated (${TICK_RANGE_CHECK_TIMEOUT} minutes)`);

        await sleep(60 * TICK_RANGE_CHECK_TIMEOUT * 1000);
    }

    // wrap ETH if balance of ETH > 0 to get WETH
    const balanceETH: bigint = await ethers.provider.getBalance(CONTRACT_ADDRESS);
    if (balanceETH > 0n && (poolConfig.token0 == POOL.ARBITRUM.WETH || poolConfig.token1 == POOL.ARBITRUM.WETH)) {
        // Take in consideration gasUsed for approval is not computed in Google Sheets
        customLog(`[${getTimestamp()}] - Wrapping ETH`);
        await contract.wrap();
    }

    const b_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
    const b_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

    if (b_amount0 == 0n && b_amount1 == 0n) {
        throw new Error("Contract balance of token0 and token1 is 0");
    }

    const info: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), Number(LOWER_RANGE_PERCENT), Number(UPPER_RANGER_PERCENT));
    getRatioOfTokensAtPrice(decimals0, decimals1, info);

    const weight0: number = Number(b_amount0) / (10 ** decimals0) * info.price;
    const weight1: number = Number(b_amount1) / (10 ** decimals1);

    const totalWeightInY: number = weight0 + weight1;

    // weight0 + weight1 = total price (y/x) of balance
    // we then multiply by ratio to get the portion which has to go in the tokenX
    // for swap0 / params.price to convert back to X

    // swap0 and swap1 = number of each token to we have to hold for to get a perfect ratio for providing liquidity
    const swap0: number = totalWeightInY * (info.ratio0 / 100) / info.price * (10 ** decimals0);
    const swap1: number = totalWeightInY * (info.ratio1 / 100) * (10 ** decimals1);

    let swapData: ISwapData | Record<string, never> = {};
    let option: boolean = false;

    // swap token1 to token0
    if (BigInt(Math.floor(swap0)) > b_amount0) {
        swapData = await swapToken1ToToken0(contract, poolConfig, info, swap0, b_amount0, decimals0, decimals1);
        option = true;
    }
    // swap token0 to token1
    else if (BigInt(Math.floor(swap1)) > b_amount1) {
        swapData = await swapToken0ToToken1(contract, poolConfig, info, swap1, b_amount1, decimals0, decimals1);
        option = false;
    }
    // in case the position was perfectly divided and no swap was needed
    else {
        swapData = {
            timestamp: getTimestamp(),
            amountIn: 0n,
            gasUsed: 0n,
        };
    }

    const a_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
    const a_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

    const swapLogsParams: ISwapLogs = {
        timestamp: swapData.timestamp,
        gasUsed: swapData.gasUsed,
        token0: poolConfig.token0,
        token1: poolConfig.token1,
        decimals0: decimals0,
        decimals1: decimals1,
        option: option,
        b_amount0: b_amount0,
        b_amount1: b_amount1,
        a_amount0: a_amount0,
        a_amount1: a_amount1,
        weight0: weight0,
        weight1: weight1,
        totalWeightInY: totalWeightInY,
        swap0: swap0,
        swap1: swap1,
        lowerTick: info.lowerTick,
        upperTick: info.upperTick,
        lowerPrice: info.lowerPrice,
        upperPrice: info.upperPrice,
        price: info.price,
        ratio0: info.ratio0,
        ratio1: info.ratio1,
    };

    customLog(`[${swapData.timestamp}] - Swap executed from ${option ? "token1" : "token0"} to ${option ? "token0" : "token1"}`);

    const amount0ToMint: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
    const amount1ToMint: bigint = await token1.balanceOf(CONTRACT_ADDRESS);
    
    // mint new position
    const mint: ContractTransactionResponse = await contract.mintNewPosition(
        amount0ToMint,
        amount1ToMint,
        info.lowerTick,
        info.upperTick,
    );
    
    const mintTimestamp: string = getTimestamp();
    const mintReceipt: ContractTransactionReceipt | null = await mint.wait(1);
    const mintGasUsed: bigint = mintReceipt!.gasUsed * mintReceipt!.gasPrice;

    // Approve contract to pull ownership of position NFT
    const nfmp: INonfungiblePositionManager = await ethers.getContractAt("INonfungiblePositionManager", NFMP_ADDRESS);
    const approval: ContractTransactionResponse = await nfmp.setApprovalForAll(CONTRACT_ADDRESS, true);

    const approvalReceipt: ContractTransactionReceipt | null = await approval.wait(1);
    const approvalGasUsed: bigint = approvalReceipt!.gasUsed * approvalReceipt!.gasPrice;

    const newPositionData: IPositionData = await contract.positionData();

    // set tokenId in a hidden file for webhook.sh
    await fs.remove(".token_id");
    fs.appendFile(".token_id", `${newPositionData.tokenId}`);

    const mintLogsParams: IMintLogs = {
        timestamp: mintTimestamp,
        tokenId: newPositionData.tokenId,
        gasUsed: mintGasUsed + approvalGasUsed,
        lowerTick: info.lowerTick,
        upperTick: info.upperTick,
        lowerPrice: info.lowerPrice,
        upperPrice: info.upperPrice,
        price: info.price,
        amount0ToMint: amount0ToMint,
        amount1ToMint: amount1ToMint,
    };

    // Send swap and Mint logs at the same time to reduce delay between swap and mint and reduce remaining capital after mint

    customLog(`[${mintTimestamp}] - New position (Token ID: ${newPositionData.tokenId}) has been minted`);

    // Discord Webhook
    await sendSwapLogsWebhook(swapLogsParams);
    // Google Sheets API
    await sendSwapLogsGSheet(doc, swapLogsParams, poolConfig);

    // Discord Webhook
    await sendMintLogsWebhook(mintLogsParams);
    // Google Sheets API
    await sendMintLogsGSheet(doc, mintLogsParams, token0, token1);

    // sleep
    await sleep(60 * TICK_RANGE_CHECK_TIMEOUT * 1000);
};

const run = async (): Promise<void> => {
    for (;;) {
        await bot()
            .catch(async (error: Error): Promise<void> => {
                await sendErrorLogsWebhook("bot.ts", error);
                console.error(error);
                process.exit(1);
            });
    }
}

run();