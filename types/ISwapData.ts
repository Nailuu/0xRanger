export type ISwapData = {
    timestamp: string;
    amountIn: bigint;
    totalGasUsed: bigint;
    gasPrice: bigint;
    gasUsed: bigint;
    priceAfterSwap: number;
}