import { ethers, deployments, getNamedAccounts } from "hardhat";
import { Deployment } from "hardhat-deploy/types";
import {
    Contract,
    ContractTransactionResponse,
    ContractTransactionReceipt,
} from "ethers";
import { sendErrorLogsWebhook } from "../../helper-hardhat-config";
import { IERC20 } from "../../typechain-types";

const ARB_WETH: string = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

const DEBUG: boolean = true;

// Parameters of Ranger.collect()
// tokens = array of tokens address you wanna collect
// withdrawETH = true if you wanna withdraw ETH from contract balance aswell
const tokens: string[] = [];
const withdrawETH: boolean = false;

const collect = async () => {
    const { deployer } = await getNamedAccounts();

    const contractDeploymentInfo: Deployment = await deployments.get("Ranger");
    const contract: Contract = await ethers.getContractAt(
        contractDeploymentInfo.abi,
        contractDeploymentInfo.address,
    );

    const contractAddress: string = await contract.getAddress();

    const tokensContract: IERC20[] = [];
    const symbols: string[] = [];
    const deployerBalanceBefore: bigint[] = [];

    let hasWETH: boolean = false;

    // Loop trough every tokens
    for (let i = 0; i < tokens.length; i++) {
        // Check if string is a valid ethereum address
        if (!ethers.isAddress(tokens[i])) {
            console.log("Invalid address: ", tokens[i]);
            return;
        }

        if (tokens[i].toLowerCase() == ARB_WETH.toLowerCase()) {
            hasWETH = true;
        }

        const token: IERC20 = await ethers.getContractAt("IERC20", tokens[i]);
        tokensContract.push(token);

        // Transactions will fail if it's not an ERC20 address
        const symbol: string = await token.symbol();
        symbols.push(symbol);

        const deployerBalance: bigint = await token.balanceOf(deployer);
        deployerBalanceBefore.push(deployerBalance);

        console.log(`token${i}: ${symbol}`);
    }

    const deployerBalanceETH: bigint =
        await ethers.provider.getBalance(deployer);

    if (DEBUG) {
        console.log("[DEBUG] symbols: \n", symbols);
        console.log("[DEBUG] deployerBalanceBefore: \n", deployerBalanceBefore);
    }

    const tx: ContractTransactionResponse = await contract.collect(
        tokens,
        withdrawETH,
    );
    if (DEBUG) {
        console.log("[DEBUG] collect(): \n", tx);
    }

    await tx.wait(1);

    const receipt: ContractTransactionReceipt | null = await tx.wait();
    const gasUsedInETH: bigint = receipt!.gasUsed * receipt!.gasPrice;

    console.log("Successfully collect!");

    // Think about WETH case...
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].toLowerCase() != ARB_WETH.toLowerCase()) {
            const deployerBalanceAfter: bigint =
                await tokensContract[i].balanceOf(deployer);

            const result: bigint =
                deployerBalanceAfter - deployerBalanceBefore[i];

            console.log(`${symbols[i]}: ${result}`);
        }
    }

    if (withdrawETH || hasWETH) {
        const balance: bigint = await ethers.provider.getBalance(deployer);

        // MAKE SURE THIS IS OK??!! DONT HAVE ALL MY MIND ATM
        const result: bigint = balance - deployerBalanceETH - gasUsedInETH;
        console.log(
            `${hasWETH ? (withdrawETH ? "ETH + WETH:" : "WETH") : "ETH:"} ${result}`,
        );
    }
};

collect()
    .then(() => process.exit(0))
    .catch(async (error: Error) => {
        await sendErrorLogsWebhook("withdraw.ts", error);
        console.error(error);
        process.exit(1);
    });
