// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// All uniswapV3 contracts are imported locally from
// https://github.com/Uniswap/v3-core/tree/0.8
// https://github.com/Uniswap/v3-periphery/tree/0.8
// to get solidity v0.8 compatibility

import "./uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "./uniswap/v3-core/contracts/libraries/TickMath.sol";
import "./uniswap/v3-core/contracts/libraries/FullMath.sol";

import "./uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "./uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "./uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "./uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "./uniswap/v3-periphery/contracts/interfaces/external/IWETH9.sol";
import "./uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

import "hardhat/console.sol";

/// @title Ranger
/// @author Nailu - https://github.com/Nailuu
/// @notice Semi-automatic contract that update a Uniswap V3 LP position to optimize APR by staying within range and adding fees
contract Ranger is IERC721Receiver {
    IWETH9 private constant WETH9 =
        IWETH9(0x82aF49447D8a07e3bd95BD0d56f35241523fBab1);

    INonfungiblePositionManager private constant NFPM =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    IUniswapV3Factory private constant FACTORY =
        IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    ISwapRouter private constant ROUTER =
        ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);

    address private immutable OWNER;

    /** @notice Structure to holds the current position data used to determine if
    the position is still in range but also to withdraw position */
    struct PositionData {
        uint256 tokenId;
        uint128 liquidity;
        int24 tickLower;
        int24 tickUpper;
        bool active;
    }

    /// @notice Structure to holds the current Uniswap V3 LP settings used to swap, create and delete positions
    struct PoolConfig {
        address pool;
        address token0;
        address token1;
        uint8 decimals0;
        uint8 decimals1;
        uint16 fee;
    }

    /// @notice Structure to holds result of a withdrawLiquidity call
    struct WithdrawResult {
        uint256 amount0;
        uint256 amount1;
        uint256 fee0;
        uint256 fee1;
    }

    PoolConfig public poolConfig;
    PositionData public positionData;
    WithdrawResult public withdrawResult;

    error Unauthorized();
    error ContractNotApproved();
    error FailedToSendETH();
    error FailedToWrapETH();
    error NotWETH();
    error InvalidPoolConfig();
    error NoActivePosition();
    error AlreadyActivePosition();

    modifier onlyOwner() {
        if (msg.sender != OWNER) {
            revert Unauthorized();
        }
        _;
    }

    /// @param token0 address of the first token from the Uniswap V3 LP you want to use
    /// @param token1 address of the second token from the Uniswap V3 LP you want to use
    /// @param fee fee of the Uniswap V3 LP, can be retrieved from (LP Pool).fee
    /// @param pool address of Uniswap V3 LP target
    /** @dev Contract deployment will revert if a Uniswap V3 LP doesn't exist with
    given parameters or pool return by Uniswap V3 Factory is not the same as "pool" parameter address */
    constructor(address token0, address token1, uint16 fee, address pool) {
        OWNER = msg.sender;

        setPoolConfig(token0, token1, fee, pool);
    }

    /// @dev Needed for WETH unwrapping, because withdraw is going to call with value this contract I guess
    receive() external payable {
        if (msg.sender != address(WETH9) && msg.sender != OWNER) {
            revert NotWETH();
        }
    }

    /// @notice this function is called whenever the contrat has a ETH balance > 0, just before swapping to wrap ETH into WETH if WETH is one of tokens
    function wrap() external onlyOwner {
        if (address(this).balance > 0) {
            (bool sent, ) = address(WETH9).call{value: address(this).balance}(
                ""
            );
            if (!sent) {
                revert FailedToWrapETH();
            }
        }
    }

    /// @dev Implementing `onERC721Received` so this contract can receive custody of erc721 tokens
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        // _setPositionData(tokenId);
        return this.onERC721Received.selector;
    }

    /// @notice Update PoolConfig structure with new Uniswap V3 LP
    /// @param token0 address of token0
    /// @param token1 address of token1
    /// @param fee fee from the Uniswap V3 LP with pair of token0 and token1
    /// @param pool address of Uniswap V3 LP target
    /** @dev Transaction will revert if a Uniswap V3 LP doesn't exist with
    given parameters or pool return by Uniswap V3 Factory is not the same as "pool" expected from parameter address */
    function setPoolConfig(
        address token0,
        address token1,
        uint16 fee,
        address pool
    ) public onlyOwner {
        address _pool = FACTORY.getPool(token0, token1, fee);
        if (
            _pool == 0x0000000000000000000000000000000000000000 || _pool != pool
        ) {
            revert InvalidPoolConfig();
        }

        (uint8 decimals0, uint8 decimals1) = (
            ERC20(token0).decimals(),
            ERC20(token1).decimals()
        );
        poolConfig = PoolConfig(
            _pool,
            token0,
            token1,
            decimals0,
            decimals1,
            fee
        );
    }

    /// @notice Update PositionData structure with new position parameters
    function _setPositionData(uint256 tokenId) internal {
        (
            ,
            ,
            ,
            ,
            ,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            ,

        ) = NFPM.positions(tokenId);

        positionData = PositionData(
            tokenId,
            liquidity,
            tickLower,
            tickUpper,
            true
        );
    }

    /// @notice mint new Uniswap V3 LP position with given parameters
    /// @param amount0ToMint amount of token0 you want to send in the position
    /// @param amount1ToMint amount of token1 you want to send in the position
    /// @param amount0Min minimum amount0ToMint to put in the position for slippage protection, send amount0ToMint - 0.1%
    /// @param amount1Min minimum amount1ToMint to put in the position for slippage protection, send amount1ToMint - 0.1%
    /// @param lowerTick lower tick for Uniswap V3 LP position range, the tick need to be initalized (see TickSpacing)
    /// @param upperTick upper tick for Uniswap V3 LP position range, the tick need to be initalized (see TickSpacing)
    /** @dev the minted position's ownership will be transfered to the owner for security reason,
    the smart contract need to be ApprovedForAll in order to pull the Uniswap V3 Position every time it need */
    function mintNewPosition(
        uint256 amount0ToMint,
        uint256 amount1ToMint,
        uint256 amount0Min,
        uint256 amount1Min,
        int24 lowerTick,
        int24 upperTick
    )
        public
        onlyOwner
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        if (positionData.active) {
            revert AlreadyActivePosition();
        }

        // Approve nfpm to pull tokens
        TransferHelper.safeApprove(
            poolConfig.token0,
            address(NFPM),
            amount0ToMint
        );
        TransferHelper.safeApprove(
            poolConfig.token1,
            address(NFPM),
            amount1ToMint
        );

        (tokenId, liquidity, amount0, amount1) = NFPM.mint(
            INonfungiblePositionManager.MintParams({
                token0: poolConfig.token0,
                token1: poolConfig.token1,
                fee: poolConfig.fee,
                tickLower: lowerTick,
                tickUpper: upperTick,
                amount0Desired: amount0ToMint,
                amount1Desired: amount1ToMint,
                // amountXMin - (amountXMin / 1000) to substract 0.1% with small rounding error
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Update positionData values
        _setPositionData(tokenId);

        // Remove allowance and refund in both assets.
        if (amount0 < amount0ToMint) {
            TransferHelper.safeApprove(poolConfig.token0, address(NFPM), 0);
        }

        if (amount1 < amount1ToMint) {
            TransferHelper.safeApprove(poolConfig.token1, address(NFPM), 0);
        }

        NFPM.safeTransferFrom(address(this), msg.sender, tokenId);
    }

    /// @notice Withdraw all the tokens and the fees from the Uniswap V3 LP Position
    /// @param amount0Min minimum amount0 to get from token0 for slippage protection, send amount0 from getAmountsForPosition - 0.1%
    /// @param amount0Min minimum amount1 to get from token1 for slippage protection, send amount1 from getAmountsForPosition - 0.1%
    function withdrawLiquidity(
        uint256 amount0Min,
        uint256 amount1Min
    ) external onlyOwner {
        if (!positionData.active) {
            revert NoActivePosition();
        }

        // Transfer ownership to itself (smart contract)
        // Smart contract needs to be setApprovalForAll !!
        NFPM.safeTransferFrom(msg.sender, address(this), positionData.tokenId);

        // amount0Min and amount1Min are price slippage checks
        // if the amount received after burning is not greater than these minimums, transaction will fail
        // Decrease full liquidity (basically delete position)
        // RETURN fee0 and fee1
        (uint256 fee0, uint256 fee1) = NFPM.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: positionData.tokenId,
                liquidity: positionData.liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: block.timestamp
            })
        );

        // Call to safeTransfer will trigger `onERC721Received` which must return the selector else transfer will fail
        // Collect fees + tokens owed from decrease liquidity
        // to get fees earned amount0 - fee0 and amount1 - fee1
        // WARNING: Need to look about rounding...
        (uint256 amount0, uint256 amount1) = NFPM.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionData.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        withdrawResult = WithdrawResult(
            amount0,
            amount1,
            (amount0 - fee0),
            (amount1 - fee1)
        );

        positionData.active = false;
    }

    /// @notice Can be used to withdraw tokens or ETH from contract
    /// @param tokens array of address of every ERC20 tokens held by the contract you want to withdraw and send to _owner
    /// @param withdrawETH if true the contract will try to send his ETH balance to owner
    /// @dev The function will unwrap WETH and send in ETH in case of token[i] == addressOfWETH
    /// @dev Never send more then type(uint256).max tokens in tokens parameter because the loop is unchecked for gas optimization
    function collect(
        address[] calldata tokens,
        bool withdrawETH
    ) external onlyOwner {
        if (withdrawETH && address(this).balance > 0) {
            (bool send, ) = msg.sender.call{value: address(this).balance}("");
            if (!send) {
                revert FailedToSendETH();
            }
        }

        // Cache array length
        uint256 length = tokens.length;

        // Loops gas optimization article
        // https://hackmd.io/@totomanov/gas-optimization-loops
        uint256 i;
        for (; i < length; ) {
            uint256 balance = IERC20(tokens[i]).balanceOf(address(this));
            if (balance > 0) {
                _transferToken(tokens[i], balance);
            }

            // to avoid overflow checking and save some gas (assume tokens.length < type(uint).max tho)
            unchecked {
                i++;
            }
        }
    }

    /** @dev used in TypeScript script to retrieve current amount of token0 and token1 based on position parameters
    and Uniswap V3 LP current tick */
    /// @param poolAddress PoolConfig.pool
    /// @param liquidity PositionData.liquidity
    /// @param lowerTick PositionData.tickLower
    /// @param upperTick PositionData.tickUpper
    /// @return amount0 amount of token0 in the position at the current Uniswap V3 LP tick
    /// @return amount1 amount of token1 in the position at the current Uniswap V3 LP tick
    function getAmountsForPosition(
        address poolAddress,
        uint128 liquidity,
        int24 lowerTick,
        int24 upperTick
    ) external view returns (uint256 amount0, uint256 amount1) {
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();

        (uint160 sqrtRatioAX96, uint160 sqrtRatioBX96) = (
            TickMath.getSqrtRatioAtTick(lowerTick),
            TickMath.getSqrtRatioAtTick(upperTick)
        );

        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            liquidity
        );
    }

    /// @dev If token is WETH, the function will unwrap token and send ETH to owner
    function _transferToken(address token, uint256 amount) internal {
        // If token is Wrapped Ether, unwrapped and send ETH to owner
        if (address(WETH9) == token) {
            WETH9.withdraw(amount);
            (bool sent, ) = msg.sender.call{value: amount}("");
            if (!sent) {
                revert FailedToSendETH();
            }
        } else {
            TransferHelper.safeTransfer(token, msg.sender, amount);
        }
    }

    /// @dev The function return the sqrtPriceX96 based on the average tick on the given period of time
    /// @param pool Address of the pool
    /** @param twapInterval Time in seconds to observe the pool
    (e.g. 60 will average the tick of the last 60 seconds) **/
    /// @return sqrtPriceX96 Price based on average tic in .X96
    function getSqrtTwapX96(
        address pool,
        uint32 twapInterval
    ) external view returns (uint160 sqrtPriceX96) {
        if (twapInterval == 0) {
            // return the current price if twapInterval == 0
            (sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
        } else {
            uint32[] memory secondsAgos = new uint32[](2);
            secondsAgos[0] = twapInterval; // from (before)
            secondsAgos[1] = 0; // to (now)

            (int56[] memory tickCumulatives, ) = IUniswapV3Pool(pool).observe(
                secondsAgos
            );

            int56 tickCumulativesDelta = tickCumulatives[1] -
                tickCumulatives[0];

            int24 arithmeticMeanTick = int24(
                tickCumulativesDelta / int56(uint56(twapInterval))
            );

            if (
                tickCumulativesDelta < 0 &&
                (tickCumulativesDelta % int56(uint56(twapInterval)) != 0)
            ) arithmeticMeanTick--;

            // tick(imprecise as it's an integer) to price
            sqrtPriceX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);
        }
    }

    /// @notice Execute a single swap from tokenX to tokenY with an input of tokenX
    /// @param tokenIn Address of the tokenX (input)
    /// @param tokenOut Address of the tokenY (output)
    /// @param amountIn Amount of tokenX that you want to swap to tokenY
    /// @param lowerTick lowerTick for minting
    /// @param upperTick upperTick for minting
    /** @dev Careful amountIn has to be in decimals of the tokenIn
    (e.g. for WETH, 18 decimals and you want to provide 1 WETH = 1 * 1e18)
    **/
    /// @param amountOutMinimum Safety minimum amount to receive in tokenY otherwise revert
    function swapAndMint(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        int24 lowerTick,
        int24 upperTick
    ) external onlyOwner {
        TransferHelper.safeApprove(tokenIn, address(ROUTER), amountIn);

        // https://docs.uniswap.org/contracts/v3/guides/swaps/single-swaps
        ROUTER.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolConfig.fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        (uint256 amount0, uint256 amount1) = (
            IERC20(poolConfig.token0).balanceOf(address(this)),
            IERC20(poolConfig.token1).balanceOf(address(this))
        );
        (uint256 amount0min, uint256 amount1min) = (
            amount0 - amount0 / 200,
            amount1 - amount1 / 200
        );

        mintNewPosition(
            amount0,
            amount1,
            amount0min,
            amount1min,
            lowerTick,
            upperTick
        );
    }
}
