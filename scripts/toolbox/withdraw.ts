import { ethers, deployments } from "hardhat";
import { Deployment } from "hardhat-deploy/types";
import { Contract } from "ethers";
import { IPoolConfig } from "../../types/IPoolConfig";
import { IPositionData } from "../../types/IPositionData";
import { sendErrorLogsWebhook } from "../../helper-hardhat-config";

const SLIPPAGE: number = 1 - 0.1 / 100;
const DEBUG: boolean = true;

const withdraw = async () => {
    const contractDeploymentInfo: Deployment = await deployments.get("Ranger");
    const contract: Contract = await ethers.getContractAt(
        contractDeploymentInfo.abi,
        contractDeploymentInfo.address,
    );

    const poolConfig: IPoolConfig = await contract.poolConfig();
    const positionData: IPositionData = await contract.positionData();
    if (DEBUG) {
        console.log("[DEBUG] poolConfig(): \n", poolConfig);
        console.log("[DEBUG] positionData(): \n", positionData);
    }

    if (!positionData.active) {
        console.log("No Active Position!");
        return;
    }

    const amounts: string[] = await contract.getAmountsForPosition(
        poolConfig.pool,
        positionData.liquidity,
        positionData.tickLower,
        positionData.tickUpper,
    );
    if (DEBUG) {
        console.log("[DEBUG] getAmountsForPosition(): \n", amounts);
    }

    const amount0Min: number = Math.ceil(Number(amounts[0]) * SLIPPAGE);
    const amount1Min: number = Math.ceil(Number(amounts[1]) * SLIPPAGE);
    if (DEBUG) {
        console.log("[DEBUG] AmountsMin:");
        console.log("amount0Min: ", amount0Min);
        console.log("amount1Min: ", amount1Min);
    }

    const results: string[] = await contract.withdrawLiquidity(
        amount0Min,
        amount1Min,
    );
    if (DEBUG) {
        console.log("[DEBUG] withdrawLiquidity(): \n", results);
    }

    // npx hardhat compile to get artifacts of nfpm
    const nfmp = await ethers.getContractAt(
        "INonfungiblePositionManager",
        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    );

    const position = await nfmp.positions(positionData.tokenId);
    if (position[7].toString() != "0") {
        console.log("Error: there is still liquidity in the position!");
        return;
    }

    console.log(
        "Successfully withdrawn position with token ID: ",
        positionData.tokenId,
    );
    console.log("amount0: ", results[0]);
    console.log("amount1: ", results[1]);
    console.log("fee0: ", results[2]);
    console.log("fee1: ", results[3]);
};

withdraw()
    .then(() => process.exit(0))
    .catch(async (error: Error) => {
        await sendErrorLogsWebhook("withdraw.ts", error);
        console.error(error);
        process.exit(1);
    });
