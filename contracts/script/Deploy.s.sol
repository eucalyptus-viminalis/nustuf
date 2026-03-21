// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {NustufRegistry} from "../src/NustufRegistry.sol";

contract DeployScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        NustufRegistry registry = new NustufRegistry();
        
        console.log("NustufRegistry deployed at:", address(registry));
        
        vm.stopBroadcast();
    }
}
