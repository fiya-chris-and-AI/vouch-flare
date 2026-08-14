// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// TODO: Replace this minimal interface with the full import once flare-smart-contracts-v2
// is published as a package:
//   import { IFtsoV2Interface } from "flare-smart-contracts-v2/contracts/userInterfaces/IFtsoV2Interface.sol";
interface IFtsoV2 {
    /// @notice Returns a feed value already scaled to 18 decimals ("in Wei").
    /// Payable because the production fee schedule allows a per-call fee
    /// (currently 0 on Coston2); callers can send msg.value == 0.
    function getFeedByIdInWei(bytes21 _feedId)
        external payable returns (uint256 _value, uint64 _timestamp);
}
