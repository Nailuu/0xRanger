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
};

const WHALE = {
  ETH_MAINNET: {
    DAI: "0xFd546293a729fE1A05D249Ad4F2CA984082F889e",
    USDC: "0x1bf0Aa215DAB195f21372105F53661e46F962ff3",
  },
  ARBITRUM: {},
};

describe("Ranger", async () => {
  let contract: Contract;
  let accounts: HardhatEthersSigner[];
  // let weth: IERC20;
  let usdc: IERC20;
  let dai: IERC20;

  const daiAmount = 1000n * 10n ** 18n;
  const usdcAmount = 1000n * 10n ** 6n;

  before(async () => {
    await deployments.fixture(["all"]);

    accounts = await ethers.getSigners();

    const tmp3 = await deployments.get("Ranger");
    contract = await ethers.getContractAt(tmp3.abi, tmp3.address);

    usdc = await ethers.getContractAt("IERC20", POOL.ETH_MAINNET.USDC);
    // weth = await ethers.getContractAt("IERC20", WETH);
    dai = await ethers.getContractAt("IERC20", POOL.ETH_MAINNET.DAI);

    const dai_whale = await ethers.getImpersonatedSigner(WHALE.ETH_MAINNET.DAI);
    const usdc_whale = await ethers.getImpersonatedSigner(
      WHALE.ETH_MAINNET.USDC
    );

    expect(await dai.balanceOf(dai_whale.address)).to.gte(daiAmount);
    expect(await usdc.balanceOf(usdc_whale.address)).to.gte(usdcAmount);

    await dai.connect(dai_whale).transfer(accounts[0].address, daiAmount);
    await usdc.connect(usdc_whale).transfer(accounts[0].address, usdcAmount);
  });

  it("Pool with given parameters exist", async () => {
    const factory = await ethers.getContractAt(
      "IUniswapV3Factory",
      "0x1F98431c8aD98523631AE4a59f267346ea31F984"
    );

    const pool = await factory.getPool(
      POOL.ETH_MAINNET.USDC,
      POOL.ETH_MAINNET.DAI,
      POOL.ETH_MAINNET.FEE
    );
    expect(pool).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("Mint new position", async () => {
    const contractAddress = await contract.getAddress();

    await dai.connect(accounts[0]).transfer(contractAddress, daiAmount);
    await usdc.connect(accounts[0]).transfer(contractAddress, usdcAmount);

    expect(await dai.balanceOf(contractAddress)).to.gte(daiAmount);
    expect(await usdc.balanceOf(contractAddress)).to.gte(usdcAmount);

    await contract.mintNewPosition();

    console.log(
      "DAI balance after add liquidity",
      await dai.balanceOf(accounts[0].address)
    );
    console.log(
      "USDC balance after add liquidity",
      await usdc.balanceOf(accounts[0].address)
    );
  });
});
