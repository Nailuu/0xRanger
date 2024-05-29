const POOL = {
    ETH_MAINNET: {
        USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        FEE: 100,
    },
    ARBITRUM: {
        ADDRESS: "0xC6962004f452bE9203591991D15f6b388e09E8D0",
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

// Return amount0 - slippage percent and amount1 - slippage percent
const getSlippageForAmmount = (
    slippagePercent: number,
    amount0: bigint,
    amount1: bigint,
): bigint[] => {
    const result0 = BigInt(Math.round(Number(amount0) * slippagePercent));
    const result1 = BigInt(Math.round(Number(amount1) * slippagePercent));

    return [result0, result1];
};

export { POOL, WHALE, getSlippageForAmmount };
