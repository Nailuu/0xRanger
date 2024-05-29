import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
    Contract,
    TransactionReceipt,
    ContractEvent,
    ContractTransactionResponse,
    ContractTransactionReceipt,
    EventLog,
    Log,
} from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { POOL, WHALE, getSlippageForAmmount } from "../helper-hardhat-config";
import { IPositionData } from "../interfaces/IPositionData";
import { IPoolConfig } from "../interfaces/IPoolConfig";
import { TickMath } from "@uniswap/v3-sdk";
import JSBI from "jsbi";

const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY;

const PARAMS = {
    token0amount: 5n * 10n ** 18n,
    token1amount: 7500n * 10n * 6n,
    // 1 - 0.1 / 100
    // X * (1 - 0.1 / 100) = X - 0.1%
    slippagePercent: 0.999,
};

describe("Ranger", async () => {
    let contract: Contract;
    let contractAddress: string;
    let accounts: HardhatEthersSigner[];
    let token0: Contract;
    let token1: Contract;

    let tokenId: string;
    let liquidity: number;

    before(async () => {
        await deployments.fixture(["all"]);

        accounts = await ethers.getSigners();

        const tmp3 = await deployments.get("Ranger");
        contract = await ethers.getContractAt(tmp3.abi, tmp3.address);

        contractAddress = await contract.getAddress();

        token0 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.WETH);
        token1 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.USDC);

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
        copy0.transfer(accounts[0].address, PARAMS.token0amount);

        const copy1 = (await token1.connect(token1whale)) as Contract;
        copy1.transfer(accounts[0].address, PARAMS.token1amount);
    });

    it("Pool with given parameters exist", async () => {
        const factory = await ethers.getContractAt(
            "IUniswapV3Factory",
            "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        );

        const pool = await factory.getPool(
            POOL.ARBITRUM.WETH,
            POOL.ARBITRUM.USDC,
            POOL.ARBITRUM.FEE,
        );

        expect(pool).to.not.equal("0x0000000000000000000000000000000000000000");
    });

    it("Mint new position", async () => {
        const copy0 = (await token0.connect(accounts[0])) as Contract;
        copy0.transfer(contractAddress, PARAMS.token0amount);

        const copy1 = (await token1.connect(accounts[0])) as Contract;
        copy1.transfer(contractAddress, PARAMS.token1amount);

        // Check that the tokens has successfully been transfered to smart contract
        // expect(await token0.balanceOf(contractAddress)).to.gte(
        //     PARAMS.token0amount,
        // );
        // expect(await token1.balanceOf(contractAddress)).to.gte(
        //     PARAMS.token1amount,
        // );

        // NEED TO USE SLIPPAGE AFTER BECAUSE FOR NOW THERE IS NO TICK CALCULATION AND WE PROVIVE FOR THE FULL RANGE
        // const slippage = getSlippageForAmmount(
        //     PARAMS.slippagePercent,
        //     PARAMS.token0amount,
        //     PARAMS.token1amount,
        // );

        const tx: ContractTransactionResponse = await contract.mintNewPosition(
            PARAMS.token0amount,
            PARAMS.token1amount,
            0,
            0,
            TickMath.MIN_TICK + 2,
            TickMath.MAX_TICK - 2
            // slippage[0],
            // slippage[1]
        );

        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        // VERY IMPORTANT !!!!
        // Give permission to smart contract to transfer the NFT to itself
        // Needs to be implemented in prod!
        await nfmp.setApprovalForAll(contractAddress, true);

        const positionData = await contract.positionData();

        tokenId = positionData.tokenId;
        liquidity = positionData.liquidity;
    });

    it("Collect all fees and withdraw position", async () => {
        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        const token0_before_balance = await token0.balanceOf(contractAddress);
        const token1_before_balance = await token1.balanceOf(contractAddress);

        const positionData: IPositionData = await contract.positionData();
        const poolConfig: IPoolConfig = await contract.poolConfig();

        // Get number of token0 and token1 based on liquidity, pool for sqrtPriceX96, tickLower and tickUpper
        const result: bigint[] = await contract.getAmountsForPosition(
            poolConfig.pool,
            positionData.liquidity,
            positionData.tickLower,
            positionData.tickUpper,
        );

        // Remove PARAMS.slippagePercent to amount0 and amount1 to get amount0Min and amount1Min
        const slippage = getSlippageForAmmount(
            PARAMS.slippagePercent,
            result[0],
            result[1],
        );

        await contract.withdrawLiquidity(slippage[0], slippage[1]);

        const position = await nfmp.positions(tokenId);

        // Liquidity
        expect(position[7].toString()).to.equal("0");

        // tokensOwed0 and tokensOwed1
        expect(position[10].toString()).to.equal("0");
        expect(position[11].toString()).to.equal("0");

        // Check that smart contract received the tokens back
        const token0_after_balance = await token0.balanceOf(contractAddress);
        const token1_after_balance = await token1.balanceOf(contractAddress);

        // Cannot check with to.equal PARAMS.token0.amount because there is a really small rounding in collect so the value is not exact
        expect(token0_after_balance).to.greaterThan(token0_before_balance);
        expect(token1_after_balance).to.greaterThan(token1_before_balance);
    });

    it("Collect funds from contract to owner", async () => {
        const token0address = await token0.getAddress();
        const token1address = await token1.getAddress();

        // Try to withdraw if not owner, transaction should be reverted
        const notowner = contract.connect(accounts[1]) as Contract;
        await expect(
            notowner.collect([token0address, token1address], false),
        ).to.be.revertedWithCustomError(contract, "Unauthorized");

        const token0_deployer_before_balance = await ethers.provider.getBalance(
            accounts[0].address,
        );
        const token1_deployer_before_balance = await token1.balanceOf(
            accounts[0].address,
        );

        const token0_contract_before_balance =
            await token0.balanceOf(contractAddress);
        const token1_contract_before_balance =
            await token1.balanceOf(contractAddress);

        const tx: ContractTransactionResponse = await contract.collect(
            [token0address, token1address],
            false,
        );

        const receipt: ContractTransactionReceipt | null = await tx.wait();

        const token0_contract_after_balance =
            await token0.balanceOf(contractAddress);
        const token1_contract_after_balance =
            await token1.balanceOf(contractAddress);

        // Check that contract balance for token0 and token1 is now 0
        expect(token0_contract_after_balance).to.equal(0);
        expect(token1_contract_after_balance).to.equal(0);

        const token0_deployer_after_balance = await ethers.provider.getBalance(
            accounts[0].address,
        );
        const token1_deployer_after_balance = await token1.balanceOf(
            accounts[0].address,
        );

        const gasUsedInETH = receipt!.gasUsed * receipt!.gasPrice;

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
});
