export type IMintLogs = {
    timestamp: string;
    tokenId: bigint;
    gasUsed: bigint;
    lowerTick: number;
    upperTick: number;
    lowerPrice: number;
    upperPrice: number;
    price: number;
    amount0ToMint: bigint;
    amount1ToMint: bigint;
}
