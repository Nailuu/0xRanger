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
import { IERC20, INonfungiblePositionManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const POOL = {
    ETH_MAINNET: {
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        FEE: 100,
    },
    ARBITRUM: {
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

const PARAMS = {
    token0amount: 100n * 10n ** 18n,
    token1amount: 250000n * 10n ** 6n,
};

describe("Ranger", async () => {
    let contract: Contract;
    let contractAddress: string;
    let accounts: HardhatEthersSigner[];
    let token0: IERC20;
    let token1: IERC20;

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

        await token0
            .connect(token0whale)
            .transfer(accounts[0].address, PARAMS.token0amount);
        await token1
            .connect(token1whale)
            .transfer(accounts[0].address, PARAMS.token1amount);
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
        await token0
            .connect(accounts[0])
            .transfer(contractAddress, PARAMS.token0amount);
        await token1
            .connect(accounts[0])
            .transfer(contractAddress, PARAMS.token1amount);

        // Check that the tokens has successfully been transfered to smart contract
        expect(await token0.balanceOf(contractAddress)).to.gte(
            PARAMS.token0amount,
        );
        expect(await token1.balanceOf(contractAddress)).to.gte(
            PARAMS.token1amount,
        );

        const tx: ContractTransactionResponse = await contract.mintNewPosition(
            PARAMS.token0amount,
            PARAMS.token1amount,
        );

        const nfmp: INonfungiblePositionManager = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        // VERY IMPORTANT !!!!
        // Give permission to smart contract to transfer the NFT to itself
        // Needs to be implemented in prod!
        await nfmp.setApprovalForAll(contractAddress, true);

        const receipt: ContractTransactionReceipt | null = await tx.wait();

        // Loop through every log from transactionReceipt and find eventLog with same fragment as newMint event
        // then set tokenId
        let _tokenId: string;
        let _liquidity: number;
        const event: ContractEvent = contract.getEvent("mint");
        receipt?.logs.forEach((e) => {
            const t = e as EventLog;
            if (t.fragment == event.getFragment()) {
                _tokenId = t.args[0].toString();
                _liquidity = t.args[1];
            }
        });

        // Check that tokenId is not undefined for some reason...
        expect(_tokenId!).to.not.equal(undefined);

        tokenId = _tokenId!;
        liquidity = _liquidity!;
    });

    it("Collect all fees and withdraw position", async () => {
        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        const token0_before_balance = await token0.balanceOf(contractAddress);
        const token1_before_balance = await token1.balanceOf(contractAddress);

        await contract.withdrawLiquidity(tokenId);

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

    it("Withdraw funds from contract to owner", async () => {
        const token0_deployer_before_balance = await token0.balanceOf(
            accounts[0].address,
        );
        const token1_deployer_before_balance = await token1.balanceOf(
            accounts[0].address,
        );

        // Try to withdraw if not owner, transaction should be reverted
        const notowner = contract.connect(accounts[1]) as Contract;
        await expect(notowner.safeWithdraw()).to.be.revertedWith("Not Owner!");

        const token0_contract_before_balance =
            await token0.balanceOf(contractAddress);
        const token1_contract_before_balance =
            await token1.balanceOf(contractAddress);

        await contract.safeWithdraw();

        const token0_contract_after_balance =
            await token0.balanceOf(contractAddress);
        const token1_contract_after_balance =
            await token1.balanceOf(contractAddress);

        // Check that contract balance for token0 and token1 is now 0
        expect(token0_contract_after_balance).to.equal(0);
        expect(token1_contract_after_balance).to.equal(0);

        const token0_deployer_after_balance = await token0.balanceOf(
            accounts[0].address,
        );
        const token1_deployer_after_balance = await token1.balanceOf(
            accounts[0].address,
        );

        // Check that owner has received the tokens
        expect(token0_deployer_after_balance).to.equal(
            token0_deployer_before_balance + token0_contract_before_balance,
        );
        expect(token1_deployer_after_balance).to.equal(
            token1_deployer_before_balance + token1_contract_before_balance,
        );
    });
});
