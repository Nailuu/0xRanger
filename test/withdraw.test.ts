import { expect } from "chai";
import { ethers, deployments, getNamedAccounts } from "hardhat";
import { Deployment } from "hardhat-deploy/types";
import { IPoolConfig } from "../types/IPoolConfig";
import { IPositionData } from "../types/IPositionData";
import { POOL, WHALE } from "../helper-hardhat-config";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
    Contract,
    TransactionReceipt,
    ContractEvent,
    ContractTransactionResponse,
    ContractTransactionReceipt,
    EventLog,
    Log,
    FunctionFragment,
} from "ethers";
import { TickMath } from "@uniswap/v3-sdk";

// const contractDeploymentInfo: Deployment = await deployments.get("Ranger");
//     const contract: Contract = await ethers.getContractAt(contractDeploymentInfo.abi, contractDeploymentInfo.address);

//     const poolConfig: IPoolConfig = await contract.poolConfig();
//     const positionData: IPositionData = await contract.positionData();
//     if (DEBUG) {
//         console.log("[DEBUG] poolConfig(): \n", poolConfig);
//         console.log("[DEBUG] positionData(): \n", positionData);
//     }

//     if (!positionData.active) {
//         console.log("No Active Position!");
//         return ;
//     }

//     const amounts: string[] = await contract.getAmountsForPosition(poolConfig.pool, positionData.liquidity, positionData.tickLower, positionData.tickUpper);
//     if (DEBUG) { console.log("[DEBUG] getAmountsForPosition(): \n", amounts) }

//     const amount0Min: number = Math.ceil(Number(amounts[0]) * SLIPPAGE);
//     const amount1Min: number = Math.ceil(Number(amounts[1]) * SLIPPAGE);
//     if (DEBUG) {
//         console.log("[DEBUG] AmountsMin:");
//         console.log("amount0Min: ", amount0Min);
//         console.log("amount1Min: ", amount1Min);
//     }

//     const results: string[] = await contract.withdrawLiquidity(amount0Min, amount1Min);
//     if (DEBUG) { console.log("[DEBUG] withdrawLiquidity(): \n", results) }

//     console.log("Successfully withdrawn position with token ID: ", positionData.tokenId);
//     console.log("amount0: ", results[0]);
//     console.log("amount1: ", results[1]);
//     console.log("fee0: ", results[2]);
//     console.log("fee1: ", results[3]);

const PARAMS = {
    token0amount: 5n * 10n ** 18n,
    token1amount: 7500n * 10n * 6n,
    // 1 - 0.1 / 100
    // X * (1 - 0.1 / 100) = X - 0.1%
    slippagePercent: 0.999,
};

describe("Withdraw - Toolbox", async () => {
    let contract: Contract;
    let contractAddress: string;
    let deployer: string;

    before(async () => {
        const tmp = await getNamedAccounts();
        deployer = tmp.deployer;

        const accounts: HardhatEthersSigner[] = await ethers.getSigners();

        await deployments.fixture(["all"]);

        const contractDeploymentInfo: Deployment =
            await deployments.get("Ranger");

        contract = await ethers.getContractAt(
            contractDeploymentInfo.abi,
            contractDeploymentInfo.address,
        );

        contractAddress = await contract.getAddress();

        const token0: Contract = await ethers.getContractAt(
            "IERC20",
            POOL.ARBITRUM.WETH,
        );
        const token1: Contract = await ethers.getContractAt(
            "IERC20",
            POOL.ARBITRUM.USDC,
        );

        const token0whale = await ethers.getImpersonatedSigner(
            WHALE.ARBITRUM.WETH,
        );
        const token1whale = await ethers.getImpersonatedSigner(
            WHALE.ARBITRUM.USDC,
        );

        expect(await token0.balanceOf(token0whale.address)).to.gte(
            PARAMS.token0amount,
        );
        expect(await token1.balanceOf(token1whale.address)).to.gte(
            PARAMS.token1amount,
        );

        const copy0 = (await token0.connect(token0whale)) as Contract;
        copy0.transfer(deployer, PARAMS.token0amount);

        const copy1 = (await token1.connect(token1whale)) as Contract;
        copy1.transfer(deployer, PARAMS.token1amount);

        const copy2 = (await token0.connect(accounts[0])) as Contract;
        copy2.transfer(contractAddress, PARAMS.token0amount);

        const copy3 = (await token1.connect(accounts[0])) as Contract;
        copy3.transfer(contractAddress, PARAMS.token1amount);

        const tx: ContractTransactionResponse = await contract.mintNewPosition(
            PARAMS.token0amount,
            PARAMS.token1amount,
            0,
            0,
            TickMath.MIN_TICK + 2,
            TickMath.MAX_TICK - 2,
        );

        await tx.wait(1);

        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        await nfmp.setApprovalForAll(contractAddress, true);
    });

    it("Withdraw liquidity", async () => {
        const SLIPPAGE: number = 1 - 0.1 / 100;

        const poolConfig: IPoolConfig = await contract.poolConfig();
        const positionData: IPositionData = await contract.positionData();

        const amounts: string[] = await contract.getAmountsForPosition(
            poolConfig.pool,
            positionData.liquidity,
            positionData.tickLower,
            positionData.tickUpper,
        );

        const amount0Min: number = Math.ceil(Number(amounts[0]) * SLIPPAGE);
        const amount1Min: number = Math.ceil(Number(amounts[1]) * SLIPPAGE);

        const tx: ContractTransactionResponse =
            await contract.withdrawLiquidity(amount0Min, amount1Min);

        const newAmounts: string[] = await contract.getAmountsForPosition(
            poolConfig.pool,
            positionData.liquidity,
            positionData.tickLower,
            positionData.tickUpper,
        );

        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        const position = await nfmp.positions(positionData.tokenId);

        // Check that liquidity was withdraw
        expect(position[7].toString()).to.equal("0");
    });

    it("Withdraw without active position", async () => {
        const positionData: IPositionData = await contract.positionData();

        expect(positionData.active).to.equal(false);

        await expect(
            contract.withdrawLiquidity(0, 0),
        ).to.be.revertedWithCustomError(contract, "NoActivePosition");
    });
});
