import { ethers } from "hardhat";
import {
    getTimestamp,
    getTokenInfoCoinGecko,
    sendErrorLogsWebhook,
    sendWithdrawLogsGSheet,
    sendWithdrawLogsWebhook,
    sleep,
} from "../helper-hardhat-config";
import { IPoolConfig } from "../interfaces/IPoolConfig";
import {
    Contract,
    TransactionReceipt,
    ContractTransactionResponse,
    ContractTransactionReceipt,
} from "ethers";
import {
    IERC20,
    INonfungiblePositionManager,
    IUniswapV3Pool,
    Ranger,
} from "../typechain-types";
import { IPositionData } from "../interfaces/IPositionData";
import { ISlot0 } from "../interfaces/ISlot0";
import { IAmounts } from "../interfaces/IAmounts";
import { IWithdrawResult } from "../interfaces/IWithdrawResult";

// docs: https://theoephraim.github.io/node-google-spreadsheet/#/
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { IWithdrawLogs } from "../interfaces/IWithdrawLogs";

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

// minutes
const TICK_RANGE_CHECK_TIMEOUT: number = 5;
const SLIPPAGE: number = 1 - 0.1 / 100;

const bot = async (): Promise<void> => {
    const tmp: IWithdrawLogs = {
        timestamp: getTimestamp(),
        tokenId: 541234412n,
        gasUsed: 122n,
        tick: 85000n,
        lowerTick: 83000n,
        upperTick: 88000n,
        amount0: 53453453453454348329n,
        amount1: 53453453n,
        fee0: 4324234489430424n,
        fee1: 90654n,
        b_amount0: 534534534534543n,
        b_amount1: 534534534534543n,
        a_amount0: 534534534534543n,
        a_amount1: 534534534534543n,
    };

    const tmp2: IPoolConfig = {
        pool: "test",
        token0: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        token1: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        fee: 500n,
    }

    await sendWithdrawLogsWebhook(tmp, tmp2);

    return;

    const contract: Ranger = await ethers.getContractAt(
        "Ranger",
        CONTRACT_ADDRESS,
    );

    const poolConfig: IPoolConfig = await contract.poolConfig();
    const positionData: IPositionData = await contract.positionData();

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

            const withdrawTx: ContractTransactionResponse =
                await contract.withdrawLiquidity(amount0Min, amount1Min);

            const withdrawReceipt: ContractTransactionReceipt | null =
                await withdrawTx.wait(1);
            const withdrawGasUsed =
                withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

            const withdrawResult: IWithdrawResult =
                await contract.withdrawResult();

            const a_amount0: bigint = await token0.balanceOf(CONTRACT_ADDRESS);
            const a_amount1: bigint = await token1.balanceOf(CONTRACT_ADDRESS);

            // send webhook
            await sendWithdrawLogsWebhook();

            // withdraw liquidity

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

            // send logs to google sheets
            await sendWithdrawLogsGSheet(doc, data);

            console.log(
                `[${getTimestamp()}] - Position (Token ID: ${positionData.tokenId}) has been withdrawn!`,
            );
            break;
        }

        console.log(
            `[${getTimestamp()}] - Position still in range, sleeping mode activated (${TICK_RANGE_CHECK_TIMEOUT} minutes)`,
        );
        await sleep(60 * TICK_RANGE_CHECK_TIMEOUT * 1000);
    }

    // calculate new tick range
    // create small position;
    // wait 1 block

    const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
        "INonfungiblePositionManager",
        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    );

    // approveForAll
    // wait 1 block
    const nfmp_tx: ContractTransactionResponse = await nfmp.setApprovalForAll(
        CONTRACT_ADDRESS,
        true,
    );
    await nfmp_tx.wait(1);

    // swap and provide liquidity (in one transaction)
    // POST to GSheets API with data

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
