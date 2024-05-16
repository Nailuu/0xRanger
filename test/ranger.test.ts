import { expect } from "chai";
import { ethers, deployments, network, getNamedAccounts } from "hardhat";
import { Contract } from "ethers";
import { IERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DAI = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1";

const FEE = 500;

const WHALE = "0x090ee598777CaDDAd04Df4271B167F38E73a9Bf0";
// const DAI_WHALE = "0xea2a2AC89281d1673E5018F60933970626905285";

const AMOUNT0 = 10000n;
const AMOUNT1 = 10n;

describe("Ranger", async () => {
  let contract: Contract;
  let accounts: HardhatEthersSigner[];
  let weth: IERC20;
  let usdc: IERC20;
  //   let dai: IERC20;

  before(async () => {
    await deployments.fixture(["all"]);

    accounts = await ethers.getSigners();

    const tmp = await deployments.get("Ranger");
    contract = await ethers.getContractAt(tmp.abi, tmp.address);

    usdc = await ethers.getContractAt("IERC20", USDC);
    weth = await ethers.getContractAt("IERC20", WETH);
    //     dai = await ethers.getContractAt("IERC20", DAI);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WHALE],
    });

    const whale = await ethers.getSigner(WHALE);

    //     await network.provider.request({
    //       method: "hardhat_impersonateAccount",
    //       params: [DAI_WHALE],
    //     });

    //     const dai_whale = await ethers.getSigner(DAI_WHALE);

    const token0amount = AMOUNT0 * 10n ** 6n;
    const token1amount = AMOUNT1 * 10n ** 18n;

    expect(await usdc.balanceOf(whale.address)).to.gte(token0amount);
    expect(await weth.balanceOf(whale.address)).to.gte(token1amount);

    await usdc.connect(whale).transfer(accounts[0].address, token0amount);
    await weth.connect(whale).transfer(accounts[0].address, token1amount);
  });

  it("Pool with given parameters exist", async () => {
    const factory = await ethers.getContractAt(
      "IUniswapV3Factory",
      "0x1F98431c8aD98523631AE4a59f267346ea31F984"
    );

    const pool = await factory.getPool(USDC, WETH, FEE);
    expect(pool).to.not.equal("0x0000000000000000000000000000000000000000");
  });

  it("Mint new position", async () => {
    const token0amount = AMOUNT0 * 10n ** 6n;
    const token1amount = AMOUNT1 * 10n ** 18n;

    const contractAddress = await contract.getAddress();

    await usdc.connect(accounts[0]).transfer(contractAddress, token0amount);
    await weth.connect(accounts[0]).transfer(contractAddress, token1amount);

    expect(await usdc.balanceOf(contractAddress)).to.gte(token0amount);
    expect(await weth.balanceOf(contractAddress)).to.gte(token1amount);

    await contract.mintNewPosition(token0amount, token1amount);
  });
});
