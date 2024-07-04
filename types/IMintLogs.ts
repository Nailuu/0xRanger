export type IMintLogs = {
    timestamp: string;
    tokenId: bigint;
    totalGasUsedMint: bigint;
    gasPriceMint: bigint;
    gasUsedMint: bigint;
    totalGasUsedApproval: bigint;
    gasPriceApproval: bigint;
    gasUsedApproval: bigint;
    lowerTick: number;
    upperTick: number;
    lowerPrice: number;
    upperPrice: number;
    price: number;
    amount0ToMint: bigint;
    amount1ToMint: bigint;
}
