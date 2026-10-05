const { ethers } = require('ethers');

// Converted from services/wallet/usdc_wallet.py, which used Python's
// eth_account library. `ethers` is the closest Node equivalent for wallet
// creation/signing.
//
// PRE-EXISTING SECURITY NOTE (not introduced by this conversion): both the
// original Python and this conversion generate a private key and return it
// directly in plaintext to the caller. That's inherent to what this class
// does as written - flagging it here since custodying/returning raw private
// keys like this is a significant risk in a real-money context, but "fixing"
// it (e.g. by encrypting/never-returning the key) would change the class's
// actual behavior, which the conversion brief asks not to do unless required.

class USDCWallet {
  createWallet() {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      private_key: wallet.privateKey,
    };
  }

  async signTransaction(privateKey, tx) {
    const wallet = new ethers.Wallet(privateKey);
    return wallet.signTransaction(tx);
  }
}

module.exports = USDCWallet;
