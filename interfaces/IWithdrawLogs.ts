export interface IWithdrawLogs {
    timestamp: string;
    tokenId: bigint;
    gasUsed: bigint;
    tick: bigint;
    lowerTick: bigint;
    upperTick: bigint;
    amount0: bigint;
    amount1: bigint;
    fee0: bigint;
    fee1: bigint;
    // contract before balance
    b_amount0: bigint;
    b_amount1: bigint;
    // contraft after balance
    a_amount0: bigint;
    a_amount1: bigint;
}
