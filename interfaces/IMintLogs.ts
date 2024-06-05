export interface IMintLogs {
    timestamp: string;
    tokenId: bigint;
    gasUsed: bigint;
    lowerTick: bigint;
    upperTick: bigint;
    amount0: bigint;
    amount1: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
}
