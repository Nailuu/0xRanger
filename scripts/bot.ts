import { ethers } from "hardhat";
import { getTimestamp, sendErrorLogs, sleep } from "../helper-hardhat-config";
import { IPoolConfig } from "../interfaces/IPoolConfig";
import {
    Contract,
    TransactionReceipt,
    ContractTransactionResponse,
    ContractTransactionReceipt,
} from "ethers";
import {
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

const GOOGLE_CLIENT_EMAIL: string = process.env.GOOGLE_CLIENT_EMAIL!;
const GOOGLE_PRIVATE_KEY: string = process.env.GOOGLE_PRIVATE_KEY!;
const SPREADSHEET_ID: string = process.env.SPREADSHEET_ID!;

const jwt = new JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: "https://www.googleapis.com/auth/spreadsheets",
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, jwt);

const CONTRACT_ADDRESS: string = "";

// minutes
const TICK_RANGE_CHECK_TIMEOUT: number = 5;
const SLIPPAGE: number = 1 - 0.1 / 100;

const bot = async (): Promise<void> => {
    const contract: Ranger = await ethers.getContractAt(
        "Ranger",
        CONTRACT_ADDRESS,
    );

    const poolConfig: IPoolConfig = await contract.poolConfig();
    const positionData: IPositionData = await contract.positionData();

    const pool: IUniswapV3Pool = await ethers.getContractAt(
        "IUniswapV3Pool",
        poolConfig.pool,
    );

    while (true) {
        if (!positionData.active) {
            console.log(`${getTimestamp()} - No active position found!`);
            break;
        }

        const slot0: ISlot0 = await pool.slot0();

        if (
            slot0.tick < positionData.tickLower ||
            slot0.tick > positionData.tickUpper
        ) {
            console.log(
                `${getTimestamp()} - Position out of range, withdrawing liquidity!`,
            );

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

            // send webhook

            // withdraw liquidity
            // POST to GSheets API with data

            // GSheets API
            // Timestamp? - TokenID - gasUsed - positionData.tickLower - positionData.tickUpper - slot0.tick
            // withdrawResult.amount0 - withdrawResult.amount1 - withdrawResult.fee0 - withdrawResult.fee1
            // balanceBefore.amount0 - balanceBefore.amount1 - balanceAfter.amount0 - balanceAfter.amount1

            console.log(
                `${getTimestamp()} - Position (Token ID: ${positionData.tokenId}) has been withdrawn!`,
            );
            break;
        }

        console.log(
            `${getTimestamp()} - Position still in range, sleeping mode activated (${TICK_RANGE_CHECK_TIMEOUT} minutes)`,
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

while (true) {
    bot()
        .then(() => process.exit(0))
        .catch(async (error: Error) => {
            await sendErrorLogs("bot.ts", error);
            console.error(error);
            process.exit(1);
        });
}
