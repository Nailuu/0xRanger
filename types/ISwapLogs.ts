export type ISwapLogs = {
    timestamp: string;
    totalGasUsed: bigint;
    gasPrice: bigint;
    gasUsed: bigint;
    token0: string;
    token1: string;
    decimals0: number;
    decimals1: number;
    option: boolean;
    b_amount0: bigint;
    b_amount1: bigint;
    a_amount0: bigint;
    a_amount1: bigint;
    weight0: number;
    weight1: number;
    totalWeightInY: number;
    swap0: number;
    swap1: number;
    lowerTick: number,
    upperTick: number,
    lowerPrice: number,
    upperPrice: number,
    price: number,
    priceAfterSwap: number,
    ratio0: number,
    ratio1: number
}
