// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// All uniswapV3 contracts are imported from
// https://github.com/Uniswap/v3-core/tree/0.8
// https://github.com/Uniswap/v3-periphery/tree/0.8
// to get solidity v0.8 compatible

import "./uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "./uniswap/v3-core/contracts/libraries/TickMath.sol";
import "./uniswap/v3-core/contracts/libraries/FullMath.sol";

// import "./uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "./uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "./uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";

import "hardhat/console.sol";

contract Ranger is IERC721Receiver {
    address public constant ARB_WETH =
        0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address public constant ARB_USDC =
        0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    uint24 public constant poolFee = 100;

    address public immutable i_owner;

    INonfungiblePositionManager public constant nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    struct Deposit {
        address owner;
        uint128 liquidity;
        address token0;
        address token1;
    }

    mapping(uint256 => Deposit) public deposits;

    event mint(uint _tokenId, uint128 liquidity, uint amount0, uint amount1);

    event collect(uint amount0, uint amount1);

    event withdraw(uint amount0, uint amount1);

    constructor() {
        i_owner = msg.sender;
    }

    // Implementing `onERC721Received` so this contract can receive custody of erc721 tokens
    function onERC721Received(
        address operator,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        // get position information

        _createDeposit(operator, tokenId);

        return this.onERC721Received.selector;
    }

    function _createDeposit(address owner, uint256 tokenId) internal {
        (
            ,
            ,
            address token0,
            address token1,
            ,
            ,
            ,
            uint128 liquidity,
            ,
            ,
            ,

        ) = nonfungiblePositionManager.positions(tokenId);

        // set the owner and data for position
        // operator is msg.sender
        deposits[tokenId] = Deposit({
            owner: owner,
            liquidity: liquidity,
            token0: token0,
            token1: token1
        });
    }

    function mintNewPosition(
        uint amount0ToMint,
        uint amount1ToMint
    )
        external
        onlyOwner
        returns (uint _tokenId, uint128 liquidity, uint amount0, uint amount1)
    {
        // Approve the position manager
        TransferHelper.safeApprove(
            ARB_WETH,
            address(nonfungiblePositionManager),
            amount0ToMint
        );
        TransferHelper.safeApprove(
            ARB_USDC,
            address(nonfungiblePositionManager),
            amount1ToMint
        );

        (_tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager
            .mint(
                INonfungiblePositionManager.MintParams({
                    token0: ARB_WETH,
                    token1: ARB_USDC,
                    fee: poolFee,
                    // By using TickMath.MIN_TICK and TickMath.MAX_TICK,
                    // we are providing liquidity across the whole range of the pool.
                    // Not recommended in production.
                    tickLower: TickMath.MIN_TICK,
                    tickUpper: TickMath.MAX_TICK,
                    amount0Desired: amount0ToMint,
                    amount1Desired: amount1ToMint,
                    // NEED TO IMPLEMENT SLIPPAGE PROTECTION
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: address(this),
                    deadline: block.timestamp
                })
            );

        // Create a deposit
        _createDeposit(msg.sender, _tokenId);

        // Remove allowance and refund in both assets.
        if (amount0 < amount0ToMint) {
            TransferHelper.safeApprove(
                ARB_WETH,
                address(nonfungiblePositionManager),
                0
            );
            // useless to refund owner because we want to keep funds in the same contract ?
            // uint refund0 = amount0ToMint - amount0;
            // TransferHelper.safeTransfer(ARB_WETH, msg.sender, refund0);
        }

        if (amount1 < amount1ToMint) {
            TransferHelper.safeApprove(
                ARB_USDC,
                address(nonfungiblePositionManager),
                0
            );
            // useless to refund owner because we want to keep funds in the same contract ?
            // uint refund1 = amount1ToMint - amount1;
            // TransferHelper.safeTransfer(ARB_USDC, msg.sender, refund1);
        }

        nonfungiblePositionManager.safeTransferFrom(
            address(this),
            msg.sender,
            _tokenId
        );

        emit mint(_tokenId, liquidity, amount0, amount1);
    }

    function withdrawLiquidity(
        uint256 tokenId
    ) external returns (uint256 amount0, uint256 amount1) {
        // require is only for testing to not forget about approval, can be removed in production
        require(
            nonfungiblePositionManager.isApprovedForAll(
                msg.sender,
                address(this)
            ),
            "Contract doesn't have ApprovalForAll"
        );

        // caller must be the owner of the NFT
        require(msg.sender == deposits[tokenId].owner, "Not the owner");

        // Transfer ownership to itself (smart contract)
        // Smart contract needs to be setApprovalForAll !!
        nonfungiblePositionManager.safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );

        // get liquidity data for tokenId
        uint128 liquidity = deposits[tokenId].liquidity;

        // amount0Min and amount1Min are price slippage checks
        // if the amount received after burning is not greater than these minimums, transaction will fail

        // Decrease full liquidity (basically delete position)
        // RETURN fee0 and fee1
        nonfungiblePositionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                // NEED TO IMPLEMENT SLIPPAGE PROTECTION
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        // Caller must own the ERC721 position
        // Call to safeTransfer will trigger `onERC721Received` which must return the selector else transfer will fail
        // set amount0Max and amount1Max to uint256.max to collect all fees

        // Collect fees + tokens owed from decrease liquidity
        // to get fees earned amount0 - fee0 and amount1 - fee1
        // WARNING: Need to look about rounding...
        (amount0, amount1) = nonfungiblePositionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Transfer NFT back to owner for safety reasons
        nonfungiblePositionManager.safeTransferFrom(
            address(this),
            msg.sender,
            tokenId
        );

        // emit new event collect
        emit collect(amount0, amount1);
    }

    function safeWithdraw() external onlyOwner {
        (uint amount0, uint amount1) = (
            IERC20(ARB_WETH).balanceOf(address(this)),
            IERC20(ARB_USDC).balanceOf(address(this))
        );

        TransferHelper.safeTransfer(ARB_WETH, msg.sender, amount0);
        TransferHelper.safeTransfer(ARB_USDC, msg.sender, amount1);

        emit withdraw(amount0, amount1);
    }

    modifier onlyOwner() {
        require(msg.sender == i_owner, "Not Owner!");
        _;
    }
}
