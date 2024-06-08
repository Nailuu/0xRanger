import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { Contract, ContractTransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { IERC20, Ranger } from "../typechain-types";
import { POOL, WHALE } from "../helper-hardhat-config";
import { Pool, Position, nearestUsableTick, TickMath } from "@uniswap/v3-sdk";
import { IPositionData } from "../types/IPositionData";
import { AlphaRouter, SwapAndAddConfig, SwapAndAddOptions, SwapToRatioResponse, SwapToRatioRoute, SwapToRatioStatus, SwapType } from "@uniswap/smart-order-router";
import { CurrencyAmount, Fraction, Percent, Token } from "@uniswap/sdk-core";
import { BaseProvider } from '@ethersproject/providers'
import JSBI from "jsbi";

const PARAMS = {
    token0amount: 5n * 10n ** 18n,
    token1amount: 7500n * 10n * 6n,
    // 1 - 0.1 / 100
    // X * (1 - 0.1 / 100) = X - 0.1%
    slippagePercent: 0.999,
};

const V3_SWAP_ROUTER_ADDRESS: string =
    "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS: string =
    "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

const getTokenTransferApproval = async (
    address: string,
    token: IERC20,
    amount: bigint,
) => {
    const tokenContract: IERC20 = await ethers.getContractAt(
        "IERC20",
        await token.getAddress(),
    );

    return tokenContract.approve(address, amount);
};

const countDecimals = (x: number): number => {
        if (Math.floor(x) === x) {
          return 0
        }
        return x.toString().split('.')[1].length || 0
};

const fromReadableAmount = (amount: number, decimals: number): JSBI => {
        const extraDigits = Math.pow(10, countDecimals(amount))
        const adjustedAmount = amount * extraDigits
        return JSBI.divide(
          JSBI.multiply(
            JSBI.BigInt(adjustedAmount),
            JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(decimals))
          ),
          JSBI.BigInt(extraDigits)
        )
};

describe("Swap And Add Liquidity", async () => {
    let contract: Ranger;
    let contractAddress: string;
    let accounts: HardhatEthersSigner[];
    let token0: IERC20;
    let token1: IERC20;

    let tokenId: string;

    beforeEach(async () => {
        await deployments.fixture(["all"]);

        accounts = await ethers.getSigners();

        const tmp3 = await deployments.get("Ranger");
        contract = await ethers.getContractAt("Ranger", tmp3.address);

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

        const copy0 = token0.connect(token0whale);
        copy0.transfer(contractAddress, PARAMS.token0amount);

        const copy1 = token1.connect(token1whale);
        copy1.transfer(contractAddress, PARAMS.token1amount);

        const tx: ContractTransactionResponse = await contract.mintNewPosition(
            100000,
            1000,
            0,
            0,
            TickMath.MIN_TICK + 2,
            TickMath.MAX_TICK - 2,
        );

        await tx.wait(1);

        const positionData: IPositionData = await contract.positionData();
        tokenId = positionData.tokenId.toString();

        const nfmp = await ethers.getContractAt(
            "INonfungiblePositionManager",
            "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        );

        const position = await nfmp.positions(positionData.tokenId);

        expect(position[7]).to.gte(0);

        await nfmp.setApprovalForAll(contractAddress, true);
    });

    it("1", async () => {
        const tokenInApproval = await getTokenTransferApproval(
            V3_SWAP_ROUTER_ADDRESS,
            token0,
            0n,
        );

        const tokenOutApproval = await getTokenTransferApproval(
            V3_SWAP_ROUTER_ADDRESS,
            token0,
            0n,
        );

        // const provider = newethers.JsonRpcProvider();
        // const provider = new ethers.BasePro();

        const router = new AlphaRouter({ chainId: 42161, provider });


        const test0: Token = new Token(42161, POOL.ARBITRUM.WETH, 18);
        const test1: Token = new Token(42161, POOL.ARBITRUM.USDC, 6);

        const token0CurrencyAmount = CurrencyAmount.fromRawAmount(
            test0,
            JSBI.toNumber(fromReadableAmount(0, test0.decimals)),
        );

        const token1CurrencyAmount = CurrencyAmount.fromRawAmount(
            test1,
            JSBI.toNumber(fromReadableAmount(0, test1.decimals)),
        );

        const placeholderPosition = new Position {
                pool,
                liquidity: 1,
                tickLower:
                  nearestUsableTick(pool.tickCurrent, pool.tickSpacing) -
                  pool.tickSpacing * 2,
                tickUpper:
                  nearestUsableTick(pool.tickCurrent, pool.tickSpacing) +
                  poolInfo.tickSpacing * 2
            };
        
            const swapAndAddConfig: SwapAndAddConfig = {
                ratioErrorTolerance: new Fraction(1, 100),
                maxIterations: 6,
              }

              const swapAndAddOptions: SwapAndAddOptions = {
                swapOptions: {
                  type: SwapType.SWAP_ROUTER_02,
                  recipient: contractAddress!,
                  slippageTolerance: new Percent(50, 10_000),
                  deadline: Math.floor(Date.now() / 1000) + 60 * 20,
                },
                addLiquidityOptions: {
                  tokenId: tokenId!,
                },
              }

              const routeToRatioResponse: SwapToRatioResponse = await router.routeToRatio(
                token0CurrencyAmount,
                token1CurrencyAmount,
                currentPosition,
                swapAndAddConfig,
                swapAndAddOptions
              )


              if (
                !routeToRatioResponse ||
                routeToRatioResponse.status !== SwapToRatioStatus.SUCCESS
              ) {
                // Handle Failed Transaction
              }

              const route: SwapToRatioRoute = routeToRatioResponse.result;


        const transaction = {
                data: route.methodParameters?.calldata,
                to: V3_SWAP_ROUTER_ADDRESS,
                value: route.methodParameters?.value,
                from: accounts[0].address,
        };

        const txRes = await wallet.sendTransaction(transaction);
    });
});
