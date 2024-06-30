import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
    ContractTransactionResponse,
    ContractTransactionReceipt,
    TransactionRequest
} from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
    POOL,
    WHALE,
    NFMP_ADDRESS,
    getSlippageForAmount,
    priceToRange,
    getRatioOfTokensAtPrice,
    swapToken1ToToken0,
    swapToken0ToToken1,
} from "../helper-hardhat-config";
import { IPositionData } from "../types/IPositionData";
import { IPoolConfig } from "../types/IPoolConfig";
import { IERC20, INonfungiblePositionManager, IWETH9, Ranger } from "../typechain-types";
import { IPriceRangeInfo } from "../types/IPriceRangeInfo";
import { Deployment } from "hardhat-deploy/types";

const PARAMS = {
    token0amount: 5n * 10n ** 18n,
    token1amount: 7500n * 10n ** 6n,
    // 1 - 0.1 / 100
    // X * (1 - 0.1 / 100) = X - 0.1%
    slippagePercent: 0.999,
};

describe("Ranger", async () => {
    let contract: Ranger;
    let contractAddress: string;
    let accounts: HardhatEthersSigner[];
    let poolConfig: IPoolConfig;
    let decimals0: number;
    let decimals1: number;
    let token0: IERC20;
    let token1: IERC20;

    beforeEach(async () => {
        await deployments.fixture(["all"]);

        accounts = await ethers.getSigners();

        const deploy: Deployment = await deployments.get("Ranger");
        contract = await ethers.getContractAt("Ranger", deploy.address);

        contractAddress = await contract.getAddress();

        token0 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.WETH);
        token1 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.USDC);

        const token0whale: HardhatEthersSigner = await ethers.getImpersonatedSigner(
            WHALE.ARBITRUM.WETH,
        );
        const token1whale: HardhatEthersSigner = await ethers.getImpersonatedSigner(
            WHALE.ARBITRUM.USDC,
        );

        expect(await token0.balanceOf(token0whale.address)).to.gte(
            PARAMS.token0amount,
        );
        expect(await token1.balanceOf(token1whale.address)).to.gte(
            PARAMS.token1amount,
        );

        const copy0: IERC20 = token0.connect(token0whale);
        await copy0.transfer(contractAddress, PARAMS.token0amount);

        const copy1: IERC20 = token1.connect(token1whale);
        await copy1.transfer(contractAddress, PARAMS.token1amount);

        poolConfig = await contract.poolConfig();

        decimals0 = Number(poolConfig.decimals0);
        decimals1 = Number(poolConfig.decimals1);
    });

    it("Wrap to WETH", async (): Promise<void> => {
        const tx: TransactionRequest = {
            to: contractAddress,
            value: BigInt(10 * (10 ** decimals0))
        }

       await accounts[0].sendTransaction(tx);

        const b_balance: bigint = await ethers.provider.getBalance(contractAddress);
        expect(b_balance.toString()).to.equal((10 * (10 ** decimals0)).toString());

        const weth: IWETH9 = await ethers.getContractAt("IWETH9", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1");

        const b_weth_balance: bigint = await weth.balanceOf(contractAddress);

        await contract.wrap();

        const a_balance: bigint = await ethers.provider.getBalance(contractAddress);
        expect(a_balance.toString()).to.equal("0");

        const a_weth_balance: bigint = await weth.balanceOf(contractAddress);
        expect(a_weth_balance.toString()).to.equal((Number(b_weth_balance) + (10 * (10 ** decimals0))).toString());
    })

    it("Pool Config Validation", async (): Promise<void> => {
        await contract.setPoolConfig(
            POOL.ARBITRUM.WETH,
            POOL.ARBITRUM.USDC,
            POOL.ARBITRUM.FEE,
            POOL.ARBITRUM.ADDRESS
        );

        await expect(contract.setPoolConfig(
            "0xb908362f583C8567b5B26748DF47A5365CB79945",
            "0x4c29F8A772E256bdB1BBc6d831Ee7ece3AA9f385",
            500,
            "0x0000000000000000000000000000000000000000")
        ).to.be.revertedWithCustomError(contract, "InvalidPoolConfig");

        await expect(contract.setPoolConfig(
            POOL.ARBITRUM.WETH,
            POOL.ARBITRUM.USDC,
            100,
            POOL.ARBITRUM.ADDRESS)
        ).to.be.revertedWithCustomError(contract, "InvalidPoolConfig");

        await expect(contract.setPoolConfig(
            POOL.ARBITRUM.WETH,
            POOL.ARBITRUM.USDC,
            500,
            "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9")
        ).to.be.revertedWithCustomError(contract, "InvalidPoolConfig");
    });

    it("Mint new position", async (): Promise<void> => {
        const info: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), 2.5, 2.5);

        await contract.mintNewPosition(PARAMS.token0amount, PARAMS.token1amount, 0, 0, info.lowerTick, info.upperTick);

        const newPositionData: IPositionData = await contract.positionData();

        const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
            "INonfungiblePositionManager",
            NFMP_ADDRESS,
        );

        const position = await nfmp.positions(newPositionData.tokenId);

        expect(position[5].toString()).to.equal(info.lowerTick.toString());
        expect(position[6].toString()).to.equal(info.upperTick.toString());

        expect(newPositionData.active).to.equal(true);
        expect(newPositionData.tickLower.toString()).to.equal(info.lowerTick.toString());
        expect(newPositionData.tickUpper.toString()).to.equal(info.upperTick.toString());

        await expect(
            contract.mintNewPosition(PARAMS.token0amount, PARAMS.token1amount, 0, 0, info.lowerTick, info.upperTick)
        ).to.be.revertedWithCustomError(contract, "AlreadyActivePosition");

        const owner: string = await nfmp.ownerOf(newPositionData.tokenId);
        expect(owner).to.equal(accounts[0].address);
    });

    it("Withdraw position", async (): Promise<void> => {
        await expect(contract.withdrawLiquidity(0, 0)).to.be.revertedWithCustomError(contract, "NoActivePosition");

        const poolConfig: IPoolConfig = await contract.poolConfig();

        const info: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), 2.5, 2.5);
        await contract.mintNewPosition(PARAMS.token0amount, PARAMS.token1amount, 0, 0, info.lowerTick, info.upperTick);

        const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
            "INonfungiblePositionManager",
            NFMP_ADDRESS,
        );
        await nfmp.setApprovalForAll(contractAddress, true);

        const positionData: IPositionData = await contract.positionData();

        const token0_before_balance: bigint = await token0.balanceOf(contractAddress);
        const token1_before_balance: bigint = await token1.balanceOf(contractAddress);

        // Get number of token0 and token1 based on liquidity, pool for sqrtPriceX96, tickLower and tickUpper
        const result: bigint[] = await contract.getAmountsForPosition(
            poolConfig.pool,
            positionData.liquidity,
            positionData.tickLower,
            positionData.tickUpper,
        );

        // Remove PARAMS.slippagePercent to amount0 and amount1 to get amount0Min and amount1Min
        const slippage: bigint[] = getSlippageForAmount(
            PARAMS.slippagePercent,
            result[0],
            result[1],
        );

        await contract.withdrawLiquidity(slippage[0], slippage[1]);

        const position = await nfmp.positions(positionData.tokenId);

        // Liquidity
        expect(position[7].toString()).to.equal("0");

        // tokensOwed0 and tokensOwed1
        expect(position[10].toString()).to.equal("0");
        expect(position[11].toString()).to.equal("0");

        // Check that smart contract received the tokens back
        const token0_after_balance: bigint = await token0.balanceOf(contractAddress);
        const token1_after_balance: bigint = await token1.balanceOf(contractAddress);

        // Cannot check with to.equal PARAMS.token0.amount because there is a really small rounding in collect so the value is not exact
        expect(token0_after_balance).to.greaterThan(token0_before_balance);
        expect(token1_after_balance).to.greaterThan(token1_before_balance);
    });

    it("Collect funds", async (): Promise<void> => {
        const poolConfig: IPoolConfig = await contract.poolConfig();

        const info: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), 2.5, 2.5);
        await contract.mintNewPosition(PARAMS.token0amount, PARAMS.token1amount, 0, 0, info.lowerTick, info.upperTick);

        const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
            "INonfungiblePositionManager",
            NFMP_ADDRESS,
        );
        await nfmp.setApprovalForAll(contractAddress, true);

        const positionData: IPositionData = await contract.positionData();

        // Get number of token0 and token1 based on liquidity, pool for sqrtPriceX96, tickLower and tickUpper
        const result: bigint[] = await contract.getAmountsForPosition(
            poolConfig.pool,
            positionData.liquidity,
            positionData.tickLower,
            positionData.tickUpper,
        );

        // Remove PARAMS.slippagePercent to amount0 and amount1 to get amount0Min and amount1Min
        const slippage: bigint[] = getSlippageForAmount(
            PARAMS.slippagePercent,
            result[0],
            result[1],
        );

        await contract.withdrawLiquidity(slippage[0], slippage[1]);

        const token0address: string = await token0.getAddress();
        const token1address: string = await token1.getAddress();

        // Try to withdraw if not owner, transaction should be reverted
        const notowner: Ranger = contract.connect(accounts[1]);
        await expect(
            notowner.collect([token0address, token1address], false),
        ).to.be.revertedWithCustomError(contract, "Unauthorized");

        const token0_deployer_before_balance: bigint = await ethers.provider.getBalance(
            accounts[0].address,
        );
        const token1_deployer_before_balance: bigint = await token1.balanceOf(
            accounts[0].address,
        );

        const token0_contract_before_balance: bigint =
            await token0.balanceOf(contractAddress);
        const token1_contract_before_balance: bigint =
            await token1.balanceOf(contractAddress);

        const tx: ContractTransactionResponse = await contract.collect(
            [token0address, token1address],
            false,
        );

        const receipt: ContractTransactionReceipt | null = await tx.wait();

        const token0_contract_after_balance: bigint =
            await token0.balanceOf(contractAddress);
        const token1_contract_after_balance: bigint =
            await token1.balanceOf(contractAddress);

        // Check that contract balance for token0 and token1 is now 0
        expect(token0_contract_after_balance).to.equal(0);
        expect(token1_contract_after_balance).to.equal(0);

        const token0_deployer_after_balance: bigint = await ethers.provider.getBalance(
            accounts[0].address,
        );
        const token1_deployer_after_balance: bigint = await token1.balanceOf(
            accounts[0].address,
        );

        const gasUsedInETH: bigint = receipt!.gasUsed * receipt!.gasPrice;

        // Check that owner has received the tokens
        // do check to see if weth has been unwrapped
        expect(token0_deployer_after_balance).to.equal(
            token0_deployer_before_balance +
                token0_contract_before_balance -
                gasUsedInETH,
        );
        expect(token1_deployer_after_balance).to.equal(
            token1_deployer_before_balance + token1_contract_before_balance,
        );
    });

    it("Swap", async (): Promise<void> => {
        const b_amount0: bigint = await token0.balanceOf(contractAddress);
        const b_amount1: bigint = await token1.balanceOf(contractAddress);

        const info: IPriceRangeInfo = await priceToRange(contract, poolConfig.pool, decimals0, decimals1, Number(poolConfig.fee), 2.5, 2.5);
        getRatioOfTokensAtPrice(decimals0, decimals1, info);

        const weight0: number = Number(b_amount0) / (10 ** decimals0) * info.price;
        const weight1: number = Number(b_amount1) / (10 ** decimals1);

        const totalWeightInY: number = weight0 + weight1;

        const swap0: number = totalWeightInY * (info.ratio0 / 100) / info.price * (10 ** decimals0);
        const swap1: number = totalWeightInY * (info.ratio1 / 100) * (10 ** decimals1);

        if (BigInt(Math.floor(swap0)) > b_amount0) {
            await swapToken1ToToken0(contract, poolConfig, info, swap0, b_amount0, decimals0, decimals1);
        }
        else if (BigInt(Math.floor(swap1)) > b_amount1) {
            await swapToken0ToToken1(contract, poolConfig, info, swap1, b_amount1, decimals0, decimals1);
        }

        const a_amount0: bigint = await token0.balanceOf(contractAddress);
        const a_amount1: bigint = await token1.balanceOf(contractAddress);

        const test0: number = 100 - ((Number(a_amount0) / (10 ** decimals0)) / (swap0 / (10 ** decimals0)) * 100);
        const test1: number = 100 - ((Number(a_amount1) / (10 ** decimals1)) / (swap1 / (10 ** decimals1)) * 100);

        expect(test0).to.lte(0.05);
        expect(test1).to.lte(0.05);
    })
});
