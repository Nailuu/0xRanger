// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

import "hardhat/console.sol";

/// @title Ranger
/// @author Nailu - https://github.com/Nailuu
/// @notice Semi-automatic contract that update a Uniswap V3 LP position to optimize APR by staying within range and adding fees
contract Ranger is IERC721Receiver {
    IWETH9 private constant WETH9 =
        IWETH9(0x82aF49447D8a07e3bd95BD0d56f35241523fBab1);

    INonfungiblePositionManager private constant _nfpm =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    IUniswapV3Factory private constant _factory =
        IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    ISwapRouter private constant _router =
        ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);

    address private immutable _owner;

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
        IERC20 token0;
        IERC20 token1;
        uint16 fee;
    }

    PoolConfig public poolConfig;

    PositionData public positionData;

    /// = 100 / % - (ex: 100 / 0.1%) = 1000
    uint16 public slippageTolerance;

    error Unauthorized();
    error ContractNotApproved();
    error FailedToSendETH();
    error NotWETH();
    error InvalidPoolConfig();

    modifier onlyOwner() {
        if (msg.sender != _owner) {
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
    constructor(
        address token0,
        address token1,
        uint16 fee,
        address pool,
        uint16 slippage
    ) {
        address _pool = _factory.getPool(token0, token1, fee);
        if (
            _pool == 0x0000000000000000000000000000000000000000 || _pool != pool
        ) {
            revert InvalidPoolConfig();
        }

        _owner = msg.sender;

        poolConfig = PoolConfig(pool, IERC20(token0), IERC20(token1), fee);
        slippageTolerance = slippage;
    }

    /// @dev Needed for WETH unwrapping, because withdraw is going to call with value this contract I guess
    receive() external payable {
        if (msg.sender != address(WETH9)) {
            revert NotWETH();
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
    given parameters or pool return by Uniswap V3 Factory is not the same as "pool" parameter address */
    function setPoolConfig(
        address token0,
        address token1,
        uint16 fee,
        address pool
    ) public onlyOwner {
        address _pool = _factory.getPool(token0, token1, fee);
        if (
            _pool == 0x0000000000000000000000000000000000000000 || _pool != pool
        ) {
            revert InvalidPoolConfig();
        }

        poolConfig = PoolConfig(_pool, IERC20(token0), IERC20(token1), fee);
    }

    /// @notice Update slippageTolerance used in _getSlippageAmount
    /// @param x new slippageTolerance value
    /// @dev 100 / % - (ex: 100 / 0.1%) = 1000
    function setSlippageTolerance(uint16 x) external onlyOwner {
        slippageTolerance = x;
    }

    function execute(uint256 amount0Min, uint256 amount1Min) public onlyOwner {
        // After test switch set mintNewPosition, withdrawLiquiidty to internal and remove onlyOwner to save gas
        // Assume all balance is in ETH
        if (positionData.active) {
            withdrawLiquidity(amount0Min, amount1Min);
        }
        // swap();

        // Retrieve amount to mint based on contract balance of both tokens
        (uint256 amount0ToMint, uint256 amount1ToMint) = (
            poolConfig.token0.balanceOf(address(this)),
            poolConfig.token1.balanceOf(address(this))
        );

        // Get amount - slippage tolerance
        (
            uint256 amount0ToMintMin,
            uint256 amount1ToMintMin
        ) = _getSlippageAmount(amount0ToMint, amount1ToMint);

        // mintNewPosition(
        //     amount0ToMint,
        //     amount1ToMint,
        //     amount0ToMintMin,
        //     amount1ToMintMin
        // );
    }

    /// @notice returns amounts - slippage tolerance %
    function _getSlippageAmount(
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 result0, uint256 result1) {
        result0 = amount0 - (amount0 / slippageTolerance);
        result1 = amount1 - (amount1 / slippageTolerance);
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

        ) = _nfpm.positions(tokenId);

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
        // Approve the position manager
        TransferHelper.safeApprove(
            address(poolConfig.token0),
            address(_nfpm),
            amount0ToMint
        );
        TransferHelper.safeApprove(
            address(poolConfig.token1),
            address(_nfpm),
            amount1ToMint
        );

        (tokenId, liquidity, amount0, amount1) = _nfpm.mint(
            INonfungiblePositionManager.MintParams({
                token0: address(poolConfig.token0),
                token1: address(poolConfig.token1),
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
            TransferHelper.safeApprove(
                address(poolConfig.token0),
                address(_nfpm),
                0
            );
        }

        if (amount1 < amount1ToMint) {
            TransferHelper.safeApprove(
                address(poolConfig.token1),
                address(_nfpm),
                0
            );
        }

        _nfpm.safeTransferFrom(address(this), msg.sender, tokenId);
    }

    /// @notice Withdraw all the tokens and the fees from the Uniswap V3 LP Position
    /// @param amount0Min minimum amount0 to get from token0 for slippage protection, send amount0 from getAmountsForPosition - 0.1%
    /// @param amount0Min minimum amount1 to get from token1 for slippage protection, send amount1 from getAmountsForPosition - 0.1%
    /// @return amount0 effective amount0 withdrawn from position
    /// @return amount1 effective amount1 withdrawn from position
    function withdrawLiquidity(
        uint256 amount0Min,
        uint256 amount1Min
    ) public onlyOwner returns (uint256 amount0, uint256 amount1) {
        // require is only for testing to not forget about approval, can be removed in production
        if (!_nfpm.isApprovedForAll(msg.sender, address(this))) {
            revert ContractNotApproved();
        }

        // Transfer ownership to itself (smart contract)
        // Smart contract needs to be setApprovalForAll !!
        _nfpm.safeTransferFrom(msg.sender, address(this), positionData.tokenId);

        // amount0Min and amount1Min are price slippage checks
        // if the amount received after burning is not greater than these minimums, transaction will fail
        // Decrease full liquidity (basically delete position)
        // RETURN fee0 and fee1
        _nfpm.decreaseLiquidity(
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
        (amount0, amount1) = _nfpm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionData.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        positionData.active = false;

        // Transfer NFT back to owner for safety reasons
        _nfpm.safeTransferFrom(address(this), msg.sender, positionData.tokenId);
    }

    /// @notice Can be used to withdraw tokens or ETH from contract
    /// @param tokens array of address of every ERC20 tokens held by the contract you want to withdraw and send to _owner
    /// @param withdrawETH if true the contract will try to send his ETH balance to owner
    /// @dev The function will unwrap WETH and send in ETH in case of token[i] == addressOfWETH
    /// @dev Never send more then type(uint256).max tokens in tokens parameter because the loop is unchecked for gas optimization
    function safeWithdraw(
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
}
