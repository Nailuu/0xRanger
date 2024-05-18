import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-solhint';
import 'hardhat-gas-reporter';
import 'hardhat-deploy';
import 'solidity-coverage';

require('dotenv').config();

const ARBITRUM_SEPOLIA_RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const ARBITRUM_RPC_URL = process.env.ARBITRUM_RPC_URL;
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY;
const REPORT_GAS = process.env.REPORT_GAS;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY;

const DEFAULT_COMPILER_SETTINGS = {
	version: '0.7.6',
	settings: {
		evmVersion: 'istanbul',
		optimizer: {
			enabled: true,
			runs: 800,
		},
		// metadata: {
		//   bytecodeHash: "none",
		// },
	},
};

const config: HardhatUserConfig = {
	solidity: {
		compilers: [DEFAULT_COMPILER_SETTINGS],
	},
	defaultNetwork: 'hardhat',
	networks: {
		hardhat: {
			forking: {
				enabled: true,
				// url: ETHEREUM_RPC_URL!,
				url: ARBITRUM_RPC_URL!,
				blockNumber: 212279290,
			},
			chainId: 31337,
		},
		sepolia: {
			url: ARBITRUM_SEPOLIA_RPC_URL,
			accounts: [PRIVATE_KEY!],
			chainId: 11155111,
		},
		localhost: {
			url: 'http://127.0.0.1:8545/',
			chainId: 31337,
		},
	},
	namedAccounts: {
		deployer: {
			default: 0,
		},
	},
	gasReporter: {
		enabled: REPORT_GAS ? true : false,
		currency: 'EUR',
		L2: 'arbitrum',
		outputFile: 'gas-report.txt',
		noColors: true,
		coinmarketcap: COINMARKETCAP_API_KEY,
		L2Etherscan: ARBISCAN_API_KEY,
	},
};

export default config;
