// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title VouchCreditLine
/// @author Vouch
/// @notice The guarantor — accepts a signed underwriting result and, if it was
/// signed by the currently attested underwriter key, writes exactly three
/// public numbers on-chain for the caller: limit, rule version, expiry.
/// Rejects everything else with a named revert reason — the on-chain half
/// of the 'Oh!' moment. Verification is decoupled from delivery: this
/// contract checks WHO signed a result, never HOW it arrived (real FCC
/// dispatch or the local mock-TEE path both submit through the same
/// submitResult() and are judged identically).
contract VouchCreditLine {
    struct CreditLine {
        uint128 limitUsd;
        uint32 ruleVersion;
        uint64 expiry;
    }

    /// @notice Address whose signature this contract currently trusts —
    /// the on-chain expression of "which build is attested". Set once per
    /// attested code hash by the owner (mirrors registering a TEE machine's
    /// derived address on TeeMachineRegistry; kept local here so the demo
    /// does not depend on FCC dispatch infra to prove the mechanism).
    address public attestedSigner;
    address public owner;

    mapping(address => CreditLine) public creditLines;

    event AttestedSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event CreditLineIssued(address indexed user, uint128 limitUsd, uint32 ruleVersion, uint64 expiry);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner, address _attestedSigner) {
        require(_owner != address(0), "owner cannot be zero address");
        owner = _owner;
        attestedSigner = _attestedSigner;
        emit AttestedSignerUpdated(address(0), _attestedSigner);
    }

    /// @notice Rotates the trusted signer — called after registering a new
    /// attested build (new code hash -> new derived signer address).
    function setAttestedSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "signer cannot be zero address");
        emit AttestedSignerUpdated(attestedSigner, _newSigner);
        attestedSigner = _newSigner;
    }

    /// @notice Submits a signed underwriting result. Reverts with
    /// "unattested underwriter" if the signature does not recover to the
    /// currently attested signer — this is the 'Oh!' moment: a manipulated
    /// rule build produces a different signer and is refused, visibly.
    /// @param user The wallet the credit line is issued to.
    /// @param limitUsd Credit limit in whole USD (no decimals).
    /// @param ruleVersion Version tag of the underwriting rule that produced this result.
    /// @param expiry Unix timestamp after which the credit line is no longer valid.
    /// @param signature 65-byte ECDSA signature (EIP-191 personal-sign) over the result.
    function submitResult(
        address user,
        uint128 limitUsd,
        uint32 ruleVersion,
        uint64 expiry,
        bytes calldata signature
    ) external {
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 resultHash = keccak256(
            abi.encode(bytes32("VOUCH_CREDIT_LINE"), block.chainid, address(this), user, limitUsd, ruleVersion, expiry)
        );
        address signer = _recoverSigner(resultHash, signature);
        require(signer == attestedSigner, "unattested underwriter");

        creditLines[user] = CreditLine({ limitUsd: limitUsd, ruleVersion: ruleVersion, expiry: expiry });
        emit CreditLineIssued(user, limitUsd, ruleVersion, expiry);
    }

    function _recoverSigner(bytes32 resultHash, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "signature must be 65 bytes");

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", resultHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        // forge-lint: disable-next-line(unsafe-typecast)
        r = bytes32(signature[0:32]);
        // forge-lint: disable-next-line(unsafe-typecast)
        s = bytes32(signature[32:64]);
        v = uint8(signature[64]);
        if (v < 27) {
            v += 27;
        }

        return ecrecover(ethSignedHash, v, r, s);
    }
}
