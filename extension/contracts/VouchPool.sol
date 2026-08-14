// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { VouchCreditLine } from "./VouchCreditLine.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { IFtsoV2 } from "./interfaces/IFtsoV2.sol";

/// @title VouchPool
/// @author Vouch
/// @notice Lets a wallet with a live VouchCreditLine borrow FXRP up to its
/// USD limit with NO collateral posted here — the "collateral" is the
/// enclave-attested credit line itself. USD value of a borrow/repay is
/// read live from FTSOv2's XRP/USD feed. Test-FXRP uses 6 decimals on
/// Coston2 (not 18) — every amount in this contract is in that raw unit.
contract VouchPool {
    VouchCreditLine public immutable creditLine;
    IERC20 public immutable fxrp;
    IFtsoV2 public immutable ftso;

    uint256 private constant FXRP_UNIT = 1e6;

    address public owner;
    bytes21 public xrpUsdFeedId;

    mapping(address => uint256) public borrowedFxrp;

    event Borrowed(address indexed user, uint256 fxrpAmount, uint256 usdValueWei, uint256 xrpUsdPriceWei);
    event Repaid(address indexed user, uint256 fxrpAmount);
    event FeedIdUpdated(bytes21 previousFeedId, bytes21 newFeedId);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner, address _creditLine, address _fxrp, address _ftso, bytes21 _xrpUsdFeedId) {
        require(_owner != address(0), "owner cannot be zero address");
        owner = _owner;
        creditLine = VouchCreditLine(_creditLine);
        fxrp = IERC20(_fxrp);
        ftso = IFtsoV2(_ftso);
        xrpUsdFeedId = _xrpUsdFeedId;
    }

    /// @notice Corrects the feed id without redeploying, in case the
    /// XRP/USD feed id assumed at deploy time turns out to be wrong.
    function setXrpUsdFeedId(bytes21 _newFeedId) external onlyOwner {
        emit FeedIdUpdated(xrpUsdFeedId, _newFeedId);
        xrpUsdFeedId = _newFeedId;
    }

    /// @notice Adds test-FXRP liquidity to the pool. Caller must have
    /// approved this contract first. Used once at deploy time to
    /// pre-fund the pool for the demo.
    function seed(uint256 fxrpAmount) external {
        require(fxrp.transferFrom(msg.sender, address(this), fxrpAmount), "seed transferFrom failed");
    }

    /// @notice Borrows `fxrpAmount` test-FXRP against the caller's
    /// VouchCreditLine. Reverts if there is no live credit line, if it
    /// has expired, or if the new total borrowed value would exceed the
    /// USD limit — this is the unsecured half of the demo: no collateral
    /// is posted here, ever.
    function borrow(uint256 fxrpAmount) external {
        require(fxrpAmount > 0, "amount must be positive");

        (uint128 limitUsd, , uint64 expiry) = creditLine.creditLines(msg.sender);
        require(limitUsd > 0, "no credit line");
        require(block.timestamp <= expiry, "credit line expired");

        uint256 newBorrowedFxrp = borrowedFxrp[msg.sender] + fxrpAmount;
        (uint256 newBorrowedUsdWei, uint256 priceWei) = _fxrpToUsdWei(newBorrowedFxrp);
        require(newBorrowedUsdWei <= uint256(limitUsd) * 1e18, "exceeds credit limit");

        borrowedFxrp[msg.sender] = newBorrowedFxrp;
        require(fxrp.transfer(msg.sender, fxrpAmount), "borrow transfer failed");

        (uint256 borrowedNowUsdWei, ) = _fxrpToUsdWei(fxrpAmount);
        emit Borrowed(msg.sender, fxrpAmount, borrowedNowUsdWei, priceWei);
    }

    /// @notice Repays up to `fxrpAmount` of the caller's outstanding
    /// borrow, restoring that much of the credit line's headroom.
    /// Caller must have approved this contract first.
    function repay(uint256 fxrpAmount) external {
        uint256 owed = borrowedFxrp[msg.sender];
        uint256 amount = fxrpAmount > owed ? owed : fxrpAmount;
        require(amount > 0, "nothing to repay");

        borrowedFxrp[msg.sender] = owed - amount;
        require(fxrp.transferFrom(msg.sender, address(this), amount), "repay transferFrom failed");
        emit Repaid(msg.sender, amount);
    }

    /// @notice Read-only preview for the frontend: how much more FXRP
    /// `user` could still borrow right now, given their current credit
    /// line and live price. Not `view` because the FTSOv2 read is
    /// payable; call with eth_call (0 value) from the frontend.
    function previewAvailableFxrp(address user) external payable returns (uint256) {
        (uint128 limitUsd, , uint64 expiry) = creditLine.creditLines(user);
        if (limitUsd == 0 || block.timestamp > expiry) {
            return 0;
        }
        (uint256 borrowedUsdWei, uint256 priceWei) = _fxrpToUsdWei(borrowedFxrp[user]);
        uint256 limitUsdWei = uint256(limitUsd) * 1e18;
        if (borrowedUsdWei >= limitUsdWei) {
            return 0;
        }
        uint256 headroomUsdWei = limitUsdWei - borrowedUsdWei;
        // headroomUsdWei (1e18) * FXRP_UNIT (1e6) / priceWei (1e18) -> raw FXRP units (1e6)
        return (headroomUsdWei * FXRP_UNIT) / priceWei;
    }

    function _fxrpToUsdWei(uint256 fxrpAmount) internal returns (uint256 usdWei, uint256 priceWei) {
        (priceWei, ) = ftso.getFeedByIdInWei(xrpUsdFeedId);
        require(priceWei > 0, "invalid XRP/USD price");
        usdWei = (fxrpAmount * priceWei) / FXRP_UNIT;
    }
}
