import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction, DeployResult } from "hardhat-deploy/types";
import { POOL } from "../helper-hardhat-config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    const res: DeployResult = await deploy("Ranger", {
        from: deployer,
        log: true,
        args: [POOL.ARBITRUM.WETH, POOL.ARBITRUM.USDC, POOL.ARBITRUM.FEE, POOL.ARBITRUM.ADDRESS, 1000],
    });

    //   console.log("Ranger contract deployed at: ", res.address);
};

func.tags = ["all", "ranger"];

export default func;
