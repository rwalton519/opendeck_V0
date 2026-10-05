#!/usr/bin/env node
/**
 * Deploys OpenDeckPoker.sol to whatever network POLYGON_RPC_URL points at.
 * Uses ethers v6 directly (already a backend dependency) - no Hardhat
 * runtime needed. Reads the compiled artifact from contracts/build/
 * (run `node contracts/compile.js` first if it doesn't exist yet, or after
 * changing the contract).
 *
 * Required env vars (see contracts/.env.example):
 *   POLYGON_RPC_URL      - e.g. https://polygon-rpc.com or an Alchemy/Infura URL
 *   DEPLOYER_PRIVATE_KEY - funds the deployment gas, becomes the contract owner
 *   USDC_ADDRESS         - native USDC on Polygon mainnet: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
 *                           (double-check this against Circle's current
 *                           published address before using - do not trust
 *                           this comment blindly for a mainnet deployment)
 *   OPERATOR_ADDRESS     - the backend's signing wallet (see chainConfig.js)
 *   RAKE_RECIPIENT_ADDRESS - where extracted rake accumulates
 *
 * Usage:
 *   node contracts/deploy.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const BUILD_PATH = path.join(__dirname, 'build', 'OpenDeckPoker.json');

async function main() {
  const {
    POLYGON_RPC_URL,
    DEPLOYER_PRIVATE_KEY,
    USDC_ADDRESS,
    OPERATOR_ADDRESS,
    RAKE_RECIPIENT_ADDRESS,
  } = process.env;

  const missing = ['POLYGON_RPC_URL', 'DEPLOYER_PRIVATE_KEY', 'USDC_ADDRESS', 'OPERATOR_ADDRESS', 'RAKE_RECIPIENT_ADDRESS']
    .filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('Missing required env vars:', missing.join(', '));
    console.error('See contracts/.env.example.');
    process.exit(1);
  }

  if (!fs.existsSync(BUILD_PATH)) {
    console.error(`No compiled artifact at ${BUILD_PATH}. Run: node contracts/compile.js`);
    process.exit(1);
  }
  const { abi, bytecode } = JSON.parse(fs.readFileSync(BUILD_PATH, 'utf8'));

  const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log('Deploying from:', wallet.address);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(USDC_ADDRESS, OPERATOR_ADDRESS, RAKE_RECIPIENT_ADDRESS);
  const receipt = await contract.deploymentTransaction().wait();

  console.log('Deployed OpenDeckPoker at:', await contract.getAddress());
  console.log('Deployment tx:', receipt.hash);
  console.log('\nSet this in your backend .env:');
  console.log(`OPENDECK_POKER_CONTRACT_ADDRESS=${await contract.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
