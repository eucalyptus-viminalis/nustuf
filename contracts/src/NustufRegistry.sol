// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NustufRegistry {
    struct Release {
        address creator;
        string url;
        uint256 priceUsdc;
        bytes32 contentHash;
        uint256 expiresAt;
        string title;
        string description;
        bool active;
    }

    mapping(bytes32 => Release) public releases;
    
    mapping(address => bytes32[]) public creatorReleases;
    
    bytes32[] public allReleases;

    event ReleaseAnnounced(
        bytes32 indexed releaseId,
        address indexed creator,
        string url,
        uint256 priceUsdc,
        uint256 expiresAt
    );

    event ReleaseDeactivated(bytes32 indexed releaseId);

    function announce(
        string calldata url,
        uint256 priceUsdc,
        bytes32 contentHash,
        uint256 expiresAt,
        string calldata title,
        string calldata description
    ) external returns (bytes32 releaseId) {
        require(bytes(url).length > 0, "URL required");
        require(expiresAt > block.timestamp, "Expiry must be in future");

        releaseId = keccak256(abi.encodePacked(
            msg.sender,
            url,
            contentHash,
            block.timestamp
        ));

        releases[releaseId] = Release({
            creator: msg.sender,
            url: url,
            priceUsdc: priceUsdc,
            contentHash: contentHash,
            expiresAt: expiresAt,
            title: title,
            description: description,
            active: true
        });

        creatorReleases[msg.sender].push(releaseId);
        allReleases.push(releaseId);

        emit ReleaseAnnounced(releaseId, msg.sender, url, priceUsdc, expiresAt);
    }

    function deactivate(bytes32 releaseId) external {
        require(releases[releaseId].creator == msg.sender, "Not creator");
        releases[releaseId].active = false;
        emit ReleaseDeactivated(releaseId);
    }

    function getActiveReleases(uint256 limit) external view returns (bytes32[] memory) {
        uint256 count = 0;
        uint256 maxCount = limit > 0 ? limit : 100;
        
        for (uint256 i = 0; i < allReleases.length && count < maxCount; i++) {
            bytes32 id = allReleases[i];
            if (releases[id].active && releases[id].expiresAt > block.timestamp) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allReleases.length && j < count; i++) {
            bytes32 id = allReleases[i];
            if (releases[id].active && releases[id].expiresAt > block.timestamp) {
                result[j++] = id;
            }
        }

        return result;
    }

    function getReleasesByCreator(address creator) external view returns (bytes32[] memory) {
        return creatorReleases[creator];
    }

    function getRelease(bytes32 releaseId) external view returns (Release memory) {
        return releases[releaseId];
    }

    function isValid(bytes32 releaseId) external view returns (bool) {
        Release memory r = releases[releaseId];
        return r.active && r.expiresAt > block.timestamp;
    }
}
