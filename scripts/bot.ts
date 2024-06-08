import { ethers } from "hardhat";
import {
    getRatioOfTokensAtPrice,
    getTimestamp, priceToRange,
    sendErrorLogsWebhook, sendMintLogsWebhook,
    sendWithdrawLogsGSheet,
    sendWithdrawLogsWebhook,
    sleep, swapToken0ToToken1, swapToken1ToToken0,
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

// docs: https://theoephraim.github.io/node-google-spreadsheet/#/
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { IWithdrawLogs } from "../types/IWithdrawLogs";
import { IPriceRangeInfo } from "../types/IPriceRangeInfo";

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

const CONTRACT_ADDRESS: string = "";
const LOWER_RANGE_PERCENT: number = 2.5;
const UPPER_RANGER_PERCENT: number = 2.5;

// minutes
const TICK_RANGE_CHECK_TIMEOUT: number = 5;
const SLIPPAGE: number = 1 - 0.1 / 100;

const bot = async (): Promise<void> => {
    // const tmp: IWithdrawLogs = {
    //     timestamp: getTimestamp(),
    //     tokenId: 541234412n,
    //     gasUsed: 122n,
    //     tick: 85000n,
    //     lowerTick: 83000n,
    //     upperTick: 88000n,
    //     amount0: 53453453453454348329n,
    //     amount1: 53453453n,
    //     fee0: 4324234489430424n,
    //     fee1: 90654n,
    //     b_amount0: 534534534534543n,
    //     b_amount1: 534534534534543n,
    //     a_amount0: 534534534534543n,
    //     a_amount1: 534534534534543n,
    // };

    // const tmp2: IPoolConfig = {
    //     pool: "test",
    //     token0: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    //     token1: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    //     fee: 500n,
    // }

    // await sendWithdrawLogsWebhook(tmp, tmp2);

    // return;

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

    while (true) {
        if (!positionData.active) {
            console.log(`[${getTimestamp()}] - No active position found!`);
            break;
        }

        const slot0: ISlot0 = await pool.slot0();

        if (
            slot0.tick < positionData.tickLower ||
            slot0.tick > positionData.tickUpper
        ) {
            console.log(
                `[${getTimestamp()}] - Position out of range, withdrawing liquidity!`,
            );

            const b_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
            const b_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

            const amounts: IAmounts = await contract.getAmountsForPosition(
                poolConfig.pool,
                positionData.liquidity,
                positionData.tickLower,
                positionData.tickUpper,
            );

            const amount0Min: number = Math.ceil(
                Number(amounts.amount0) * SLIPPAGE,
            );
            const amount1Min: number = Math.ceil(
                Number(amounts.amount1) * SLIPPAGE,
            );

            // withdraw liquidity and collect fees
            const withdraw: ContractTransactionResponse =
                await contract.withdrawLiquidity(amount0Min, amount1Min);

            const withdrawReceipt: ContractTransactionReceipt | null =
                await withdraw.wait(1);
            const withdrawGasUsed =
                withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

            const withdrawResult: IWithdrawResult =
                await contract.withdrawResult();

            const a_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
            const a_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

            const data: IWithdrawLogs = {
                timestamp: getTimestamp(),
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

            // Discord Webhook
            await sendWithdrawLogsWebhook(data, poolConfig);

            // Google Sheets API
            await sendWithdrawLogsGSheet(doc, data);

            console.log(
                `[${getTimestamp()}] - Position (Token ID: ${positionData.tokenId}) has been withdrawn`,
            );
            break;
        }

        console.log(
            `[${getTimestamp()}] - Position still in range, sleeping mode activated (${TICK_RANGE_CHECK_TIMEOUT} minutes)`,
        );
        await sleep(60 * TICK_RANGE_CHECK_TIMEOUT * 1000);
    }

    // wrap ETH if balance of ETH > 0 to get WETH
    const balanceETH: bigint = await ethers.provider.getBalance(CONTRACT_ADDRESS);
    if (balanceETH > 0) {
        await contract.wrap();
    }

    const balance0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
    const balance1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

    const params: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), LOWER_RANGE_PERCENT, UPPER_RANGER_PERCENT);
    getRatioOfTokensAtPrice(decimals0, decimals1, params);

    const weight0: number = Number(balance0) / (10 ** decimals0) * params.price;
    const weight1: number = Number(balance1) / (10 ** decimals1);

    const totalWeightInY: number = weight0 + weight1;

    // weight0 + weight1 = total price (y/x) of balance
    // we then multiply by ratio to get the portion which has to go in the tokenX
    // for swap0 / params.price to convert back to X

    // swap0 and swap1 = number of each token to we have to hold for to get a perfect ratio for providing liquidity
    const swap0: number = totalWeightInY * (params.ratio0 / 100) / params.price * (10 ** decimals0);
    const swap1: number = totalWeightInY * (params.ratio1 / 100) * (10 ** decimals1);

    if (BigInt(Math.floor(swap0)) > balance0) {
        // swap token1 to token0
        await swapToken1ToToken0(contract, poolConfig, swap0, balance0, params.price, decimals0, decimals1);
    } else if (BigInt(Math.floor(swap1)) > balance1) {
        // swap token0 to token1
        await swapToken0ToToken1(contract, poolConfig, swap1, balance1, params.price, decimals0, decimals1);
    }

    const amount0ToMint: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
    const amount1ToMint: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

    const amount0Min: bigint = BigInt(Math.floor(Number(amount0ToMint) * (1 - 0.5 / 100)));
    const amount1Min: bigint = BigInt(Math.floor(Number(amount1ToMint) * (1 - 0.5 / 100)));

    // mint
    const mint: ContractTransactionResponse = await contract.mintNewPosition(
        amount0ToMint,
        amount1ToMint,
        amount0Min,
        amount1Min,
        params.lowerTick,
        params.upperTick,
    );

    const mintReceipt: ContractTransactionReceipt | null = await mint.wait(1);
    const mintGasUsed = mintReceipt!.gasUsed * mintReceipt!.gasPrice;

    const newPositionData: IPositionData = await contract.positionData();

    // Discord Webhook
    await sendMintLogsWebhook();

    // Google Sheets API
    await sendMintLogsGSheet();

    console.log(
        `[${getTimestamp()}] - New position (Token ID: ${newPositionData.tokenId}) has been minted`,
    );

    const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
        "INonfungiblePositionManager",
        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    );

    // approveForAll
    // wait 1 block
    // Take in consideration gasUsed for approval is not computed in Google Sheets
    const nfmpTx: ContractTransactionResponse = await nfmp.setApprovalForAll(
        CONTRACT_ADDRESS,
        true,
    );
    await nfmpTx.wait(1);

    // sleep
    await sleep(60 * TICK_RANGE_CHECK_TIMEOUT * 1000);
};

bot()
    .then(() => process.exit(0))
    .catch(async (error: Error) => {
        await sendErrorLogsWebhook("bot.ts", error);
        console.error(error);
        process.exit(1);
    });
