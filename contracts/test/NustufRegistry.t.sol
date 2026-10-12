// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NustufRegistry} from "../src/NustufRegistry.sol";

contract NustufRegistryTest is Test {
    NustufRegistry registry;

    address creator = makeAddr("creator");
    address other = makeAddr("other");

    string constant URL = "https://example.ts.net/download";
    uint256 constant PRICE = 500_000; // 0.50 USDC
    bytes32 constant HASH = keccak256("content");

    event ReleaseAnnounced(
        bytes32 indexed releaseId,
        address indexed creator,
        string url,
        uint256 priceUsdc,
        uint256 expiresAt
    );
    event ReleaseDeactivated(bytes32 indexed releaseId);

    function setUp() public {
        registry = new NustufRegistry();
        vm.warp(1_700_000_000);
    }

    function _announce(address from, string memory url, uint256 ttl) internal returns (bytes32) {
        vm.prank(from);
        return registry.announce(url, PRICE, HASH, block.timestamp + ttl, "Title", "Description");
    }

    function test_announce_storesRelease() public {
        bytes32 id = _announce(creator, URL, 1 hours);

        NustufRegistry.Release memory r = registry.getRelease(id);
        assertEq(r.creator, creator);
        assertEq(r.url, URL);
        assertEq(r.priceUsdc, PRICE);
        assertEq(r.contentHash, HASH);
        assertEq(r.expiresAt, block.timestamp + 1 hours);
        assertEq(r.title, "Title");
        assertEq(r.description, "Description");
        assertTrue(r.active);
        assertTrue(registry.isValid(id));
    }

    function test_announce_releaseIdMatchesDerivation() public {
        bytes32 id = _announce(creator, URL, 1 hours);
        bytes32 expected = keccak256(abi.encodePacked(creator, URL, HASH, block.timestamp));
        assertEq(id, expected);
    }

    function test_announce_emitsEvent() public {
        bytes32 expectedId = keccak256(abi.encodePacked(creator, URL, HASH, block.timestamp));
        vm.expectEmit(true, true, false, true, address(registry));
        emit ReleaseAnnounced(expectedId, creator, URL, PRICE, block.timestamp + 1 hours);
        _announce(creator, URL, 1 hours);
    }

    function test_announce_tracksCreatorReleases() public {
        bytes32 a = _announce(creator, URL, 1 hours);
        bytes32 b = _announce(creator, "https://example.ts.net/other", 1 hours);
        _announce(other, URL, 1 hours);

        bytes32[] memory ids = registry.getReleasesByCreator(creator);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], b);
    }

    function test_announce_revertsWithoutUrl() public {
        vm.prank(creator);
        vm.expectRevert(bytes("URL required"));
        registry.announce("", PRICE, HASH, block.timestamp + 1 hours, "Title", "Description");
    }

    function test_announce_revertsWhenExpiryNotInFuture() public {
        vm.startPrank(creator);
        vm.expectRevert(bytes("Expiry must be in future"));
        registry.announce(URL, PRICE, HASH, block.timestamp, "Title", "Description");
        vm.expectRevert(bytes("Expiry must be in future"));
        registry.announce(URL, PRICE, HASH, block.timestamp - 1, "Title", "Description");
        vm.stopPrank();
    }

    function test_deactivate_byCreator() public {
        bytes32 id = _announce(creator, URL, 1 hours);

        vm.expectEmit(true, false, false, false, address(registry));
        emit ReleaseDeactivated(id);
        vm.prank(creator);
        registry.deactivate(id);

        assertFalse(registry.getRelease(id).active);
        assertFalse(registry.isValid(id));
    }

    function test_deactivate_revertsForNonCreator() public {
        bytes32 id = _announce(creator, URL, 1 hours);

        vm.prank(other);
        vm.expectRevert(bytes("Not creator"));
        registry.deactivate(id);

        assertTrue(registry.isValid(id));
    }

    function test_deactivate_revertsForUnknownRelease() public {
        vm.prank(creator);
        vm.expectRevert(bytes("Not creator"));
        registry.deactivate(keccak256("missing"));
    }

    function test_isValid_falseAfterExpiry() public {
        bytes32 id = _announce(creator, URL, 1 hours);
        vm.warp(block.timestamp + 1 hours);
        assertFalse(registry.isValid(id));
    }

    function test_getActiveReleases_skipsInactiveAndExpired() public {
        bytes32 live = _announce(creator, URL, 2 hours);
        _announce(creator, "https://example.ts.net/short", 1 hours); // expires below
        bytes32 deactivated = _announce(other, URL, 2 hours);

        vm.prank(other);
        registry.deactivate(deactivated);
        vm.warp(block.timestamp + 1 hours);

        bytes32[] memory ids = registry.getActiveReleases(0);
        assertEq(ids.length, 1);
        assertEq(ids[0], live);
    }

    function test_getActiveReleases_respectsLimit() public {
        for (uint256 i = 0; i < 5; i++) {
            _announce(creator, string(abi.encodePacked(URL, vm.toString(i))), 1 hours);
        }
        assertEq(registry.getActiveReleases(3).length, 3);
        assertEq(registry.getActiveReleases(0).length, 5);
    }

    function testFuzz_announce_anyFutureExpiryIsValid(uint64 ttl) public {
        vm.assume(ttl > 0);
        bytes32 id = _announce(creator, URL, ttl);
        assertTrue(registry.isValid(id));
    }
}
