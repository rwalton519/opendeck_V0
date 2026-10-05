#!/usr/bin/env node
/**
 * Compiles contracts/OpenDeckPoker.sol with solc and writes the ABI +
 * bytecode into abi/OpenDeckPoker.json (merged with the hand-authored
 * ERC20 ABI is a separate file, abi/ERC20.json - that one isn't compiled,
 * it's copied from a public ERC20 interface).
 *
 * Usage:
 *   npm install --save-dev solc@0.8.24   (one-time)
 *   node contracts/compile.js
 *
 * This project intentionally does NOT depend on the full Hardhat toolchain
 * for compilation - `solc` alone is enough to produce a verified ABI and
 * bytecode, and keeps the dependency footprint (and attack surface) small
 * for something that only needs to run occasionally. Use contracts/deploy.js
 * (ethers v6, already a backend dependency) to actually deploy the output.
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACT_PATH = path.join(__dirname, 'OpenDeckPoker.sol');
const OUTPUT_PATH = path.join(__dirname, '..', 'abi', 'OpenDeckPoker.json');
const BUILD_DIR = path.join(__dirname, 'build');

function main() {
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');

  const input = {
    language: 'Solidity',
    sources: { 'OpenDeckPoker.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    let hasFatal = false;
    for (const err of output.errors) {
      console[err.severity === 'error' ? 'error' : 'warn'](err.formattedMessage);
      if (err.severity === 'error') hasFatal = true;
    }
    if (hasFatal) {
      console.error('Compilation failed.');
      process.exit(1);
    }
  }

  const contract = output.contracts['OpenDeckPoker.sol']['OpenDeckPoker'];

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(BUILD_DIR, 'OpenDeckPoker.json'),
    JSON.stringify({ abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2)
  );
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(contract.abi, null, 2));

  console.log('Compiled OK.');
  console.log('ABI written to:', OUTPUT_PATH);
  console.log('ABI + bytecode written to:', path.join(BUILD_DIR, 'OpenDeckPoker.json'));
}

main();
