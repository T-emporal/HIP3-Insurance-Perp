// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ApportionmentLayer.sol";

/**
 * @title  ApportionmentLayerV2
 * @notice Example upgrade: adds a version getter and an f_max parameter
 *         for on-chain N* calculation.
 *
 * @dev    Demonstrates UUPS upgrade path. State from V1 is fully preserved.
 *         New storage variables are appended after existing V1 storage.
 */
contract ApportionmentLayerV2 is ApportionmentLayer {

    // ── New storage (appended after V1 layout) ──────────────────────────

    /// @notice Maximum funding rate in basis points (e.g. 10 = 0.1%)
    uint256 public fMaxBps;

    // ── New functions ───────────────────────────────────────────────────

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    /// @notice Set f_max parameter for N* calculation
    function setFMax(uint256 _fMaxBps) external onlyOwner {
        require(_fMaxBps > 0 && _fMaxBps <= 10_000, "AL: fMax out of range");
        fMaxBps = _fMaxBps;
    }

    /// @notice Calculate N* = ceil(O(T*) / f_max) — number of funding intervals needed
    function calculateNStar() external view returns (uint256) {
        require(eventActive, "AL: no active event");
        require(fMaxBps > 0, "AL: fMax not set");
        // oracleValue6 is O(T*) * 1e6, fMaxBps is f_max * 1e4
        // N* = ceil(O(T*) / f_max) = ceil((oracleValue6 / 1e6) / (fMaxBps / 1e4))
        //    = ceil(oracleValue6 * 1e4 / (fMaxBps * 1e6))
        //    = ceil(oracleValue6 * 10000 / (fMaxBps * 1000000))
        //    = ceil(oracleValue6 / (fMaxBps * 100))
        uint256 denominator = fMaxBps * 100;
        return (oracleValue6 + denominator - 1) / denominator;
    }
}
