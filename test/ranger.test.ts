import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { Contract } from "ethers";
import { IERC20 } from "../typechain-types";
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
  let accounts: HardhatEthersSigner[];
  let token0: IERC20;
  let token1: IERC20;

  before(async () => {
    await deployments.fixture(["all"]);

    accounts = await ethers.getSigners();

    const tmp3 = await deployments.get("Ranger");
    contract = await ethers.getContractAt(tmp3.abi, tmp3.address);

    token0 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.WETH);
    token1 = await ethers.getContractAt("IERC20", POOL.ARBITRUM.USDC);

    const token0whale = await ethers.getImpersonatedSigner(WHALE.ARBITRUM.WETH);
    const token1whale = await ethers.getImpersonatedSigner(WHALE.ARBITRUM.USDC);

    expect(await token0.balanceOf(token0whale.address)).to.gte(
      PARAMS.token0amount
    );
    expect(await token1.balanceOf(token1whale.address)).to.gte(
      PARAMS.token1amount
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
      "0x1F98431c8aD98523631AE4a59f267346ea31F984"
    );

    const pool = await factory.getPool(
      POOL.ARBITRUM.WETH,
      POOL.ARBITRUM.USDC,
      POOL.ARBITRUM.FEE
    );
    expect(pool).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("Mint new position", async () => {
    const contractAddress = await contract.getAddress();

    await token0
      .connect(accounts[0])
      .transfer(contractAddress, PARAMS.token0amount);
    await token1
      .connect(accounts[0])
      .transfer(contractAddress, PARAMS.token1amount);

    expect(await token0.balanceOf(contractAddress)).to.gte(PARAMS.token0amount);
    expect(await token1.balanceOf(contractAddress)).to.gte(PARAMS.token1amount);

    await contract.mintNewPosition(PARAMS.token0amount, PARAMS.token1amount);

    // console.log(
    //   "DAI balance after add liquidity",
    //   await dai.balanceOf(accounts[0].address)
    // );
    // console.log(
    //   "USDC balance after add liquidity",
    //   await usdc.balanceOf(accounts[0].address)
    // );
  });
});
