const { ethers } = require('ethers');

class EthereumService {
  provider() {
    if (!process.env.ETH_RPC_URL) throw new Error('ETH_RPC_URL is required.');
    return new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  }
  async findDeposit(address, fromBlock) {
    const provider = this.provider();
    const latest = await provider.getBlockNumber();
    // Scan only recent blocks per tick; the monitor repeats, avoiding a
    // provider-abusive full-chain scan for every fresh deposit address.
    const start = Math.max(Number(fromBlock || latest - 120), latest - 120);
    for (let blockNo = start; blockNo <= latest; blockNo += 1) {
      const block = await provider.getBlock(blockNo, true);
      const tx = block && block.prefetchedTransactions && block.prefetchedTransactions.find((item) => item.to && item.to.toLowerCase() === address.toLowerCase() && item.value > 0n);
      if (tx) {
        const confirmations = latest - blockNo + 1;
        return { status: confirmations >= Number(process.env.ETH_REQUIRED_CONFIRMATIONS || 12) ? 'confirmed' : 'pending', txid: tx.hash, amount: ethers.formatEther(tx.value), confirmations, blockNumber: blockNo };
      }
    }
    return { status: 'watching', confirmations: 0, blockNumber: latest };
  }
  async sendWithdrawal(address, amount) {
    if (!process.env.ETH_HOT_WALLET_PRIVATE_KEY) throw new Error('ETH_HOT_WALLET_PRIVATE_KEY is required.');
    const wallet = new ethers.Wallet(process.env.ETH_HOT_WALLET_PRIVATE_KEY, this.provider());
    const tx = await wallet.sendTransaction({ to: address, value: ethers.parseEther(String(amount)) });
    return { status: 'withdrawal_sent', txid: tx.hash };
  }
}
module.exports = EthereumService;
