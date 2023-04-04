/**
 * @file src.ts
 * @description This file is used to aggregate the tools that used to interact with SUI network.
 * @author IceFox
 * @version 0.1.0
 */
import 'colorts/lib/string'
import { RawSigner, TransactionBlock } from '@mysten/sui.js'
import { SuiAccountManager, DerivePathParams } from "./sui-account-manager";
import { SuiRpcProvider, NetworkType } from './sui-rpc-provider';
import { SuiPackagePublisher, PublishOptions } from "./sui-package-publisher";
import {SuiTxBlock} from "./sui-tx-builder/sui-tx-block";

type ToolKitParams = {
  mnemonics?: string;
  secretKey?: string;
  fullnodeUrl?: string;
  faucetUrl?: string;
  networkType?: NetworkType;
  suiBin?: string;
}
/**
 * @class SuiKit
 * @description This class is used to aggregate the tools that used to interact with SUI network.
 */
export class SuiKit {

  public accountManager: SuiAccountManager;
  public rpcProvider: SuiRpcProvider;
  public packagePublisher: SuiPackagePublisher;

  /**
   * Support the following ways to init the SuiToolkit:
   * 1. mnemonics
   * 2. secretKey (base64 or hex)
   * If none of them is provided, will generate a random mnemonics with 24 words.
   *
   * @param mnemonics, 12 or 24 mnemonics words, separated by space
   * @param secretKey, base64 or hex string, when mnemonics is provided, secretKey will be ignored
   * @param networkType, 'testnet' | 'mainnet' | 'devnet', default is 'devnet'
   * @param fullnodeUrl, the fullnode url, default is the preconfig fullnode url for the given network type
   * @param faucetUrl, the faucet url, default is the preconfig faucet url for the given network type
   * @param suiBin, the path to sui cli binary, default to 'cargo run --bin sui'
   */
  constructor({ mnemonics, secretKey, networkType, fullnodeUrl, faucetUrl, suiBin }: ToolKitParams = {}) {
    // Init the account manager
    this.accountManager = new SuiAccountManager({ mnemonics, secretKey });
    // Init the rpc provider
    this.rpcProvider = new SuiRpcProvider({ fullnodeUrl, faucetUrl, networkType });
    // Init the package publisher
    this.packagePublisher = new SuiPackagePublisher(suiBin);
  }

  /**
   * if derivePathParams is not provided or mnemonics is empty, it will return the currentSigner.
   * else:
   * it will generate signer from the mnemonic with the given derivePathParams.
   * @param derivePathParams, such as { accountIndex: 2, isExternal: false, addressIndex: 10 }, comply with the BIP44 standard
   */
  getSigner(derivePathParams?: DerivePathParams) {
    const keyPair = this.accountManager.getKeyPair(derivePathParams);
    return new RawSigner(keyPair, this.rpcProvider.provider);
  }

  /**
   * @description Switch the current account with the given derivePathParams
   * @param derivePathParams, such as { accountIndex: 2, isExternal: false, addressIndex: 10 }, comply with the BIP44 standard
   */
  switchAccount(derivePathParams: DerivePathParams) {
    this.accountManager.switchAccount(derivePathParams);
  }

  /**
   * @description Get the address of the account for the given derivePathParams
   * @param derivePathParams, such as { accountIndex: 2, isExternal: false, addressIndex: 10 }, comply with the BIP44 standard
   */
  getAddress(derivePathParams?: DerivePathParams) {
    return this.accountManager.getAddress(derivePathParams);
  }
  currentAddress() { return this.accountManager.currentAddress }

  /**
   * Request some SUI from faucet
   * @Returns {Promise<boolean>}, true if the request is successful, false otherwise.
   */
  async requestFaucet(derivePathParams?: DerivePathParams) {
    const addr = this.accountManager.getAddress(derivePathParams);
    return this.rpcProvider.requestFaucet(addr);
  }

  async getBalance(coinType?: string, derivePathParams?: DerivePathParams) {
    const owner = this.accountManager.getAddress(derivePathParams);
    return this.rpcProvider.getBalance(owner, coinType);
  }

  async signTxn(tx: Uint8Array | TransactionBlock | SuiTxBlock, derivePathParams?: DerivePathParams) {
    tx = tx instanceof SuiTxBlock ? tx.txBlock : tx;
    const signer = this.getSigner(derivePathParams);
    return signer.signTransactionBlock({ transactionBlock: tx });
  }

  async signAndSendTxn(tx: Uint8Array | TransactionBlock | SuiTxBlock, derivePathParams?: DerivePathParams) {
    tx = tx instanceof SuiTxBlock ? tx.txBlock : tx;
    const signer = this.getSigner(derivePathParams);
    return signer.signAndExecuteTransactionBlock({ transactionBlock: tx, options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
    }})
  }

  /**
   * publish the move package at the given path
   * It starts a child process to call the "sui binary" to build the move package
   * The building process takes place in a tmp directory, which would be cleaned later
   * @param packagePath the path to the move package
   */
  async publishPackage(packagePath: string, options?: PublishOptions, derivePathParams?: DerivePathParams) {
    const signer = this.getSigner(derivePathParams);
    return this.packagePublisher.publishPackage(packagePath, signer)
  }

  /**
   * Transfer the given amount of SUI to the recipient
   * @param recipient
   * @param amount
   * @param derivePathParams
   */
  async transferSui(recipient: string, amount: number, derivePathParams?: DerivePathParams) {
    const tx = new SuiTxBlock();
    tx.transferSui(recipient, amount);
    return this.signAndSendTxn(tx, derivePathParams);
  }

  /**
   * Transfer to mutliple recipients
   * @param recipients the recipients addresses
   * @param amounts the amounts of SUI to transfer to each recipient, the length of amounts should be the same as the length of recipients
   * @param derivePathParams
   */
  async transferSuiToMany(recipients: string[], amounts: number[], derivePathParams?: DerivePathParams) {
    const tx = new SuiTxBlock();
    tx.transferSuiToMany(recipients, amounts);
    return this.signAndSendTxn(tx, derivePathParams);
  }

  /**
   * Transfer the given amount of coin to the recipient
   * @param recipient the recipient address
   * @param amount the amount of coin to transfer
   * @param coinType any custom coin type but not SUI
   * @param derivePathParams the derive path params for the current signer
   */
  async transferCoin(recipient: string, amount: number, coinType: `${string}::${string}::${string}`, derivePathParams?: DerivePathParams) {
    const tx = new SuiTxBlock();
    const owner = this.accountManager.getAddress(derivePathParams);
    const coins = await this.rpcProvider.selectCoins(owner, amount, coinType);
    const [sendCoin, mergedCoin] = tx.takeAmountFromCoins(coins.map(c => c.objectId), amount);
    tx.txBlock.transferObjects([sendCoin], tx.txBlock.pure(recipient));
    tx.txBlock.transferObjects([mergedCoin], tx.txBlock.pure(owner));
    return this.signAndSendTxn(tx, derivePathParams);
  }

  /**
   * stake the given amount of SUI to the validator
   * @param amount the amount of SUI to stake
   * @param validatorAddr the validator address
   * @param derivePathParams the derive path params for the current signer
   */
  async stakeSui(amount: number, validatorAddr: string, derivePathParams?: DerivePathParams) {
    const tx = new SuiTxBlock();
    tx.stakeSui(amount, validatorAddr);
    return this.signAndSendTxn(tx, derivePathParams);
  }

  /**
   * Execute the transaction with on-chain data but without really submitting. Useful for querying the effects of a transaction.
   * Since the transaction is not submitted, its gas cost is not charged.
   * @param tx the transaction to execute
   * @param derivePathParams the derive path params
   * @returns the effects and events of the transaction, such as object changes, gas cost, event emitted.
   */
  inspectTxn(tx: Uint8Array | TransactionBlock | SuiTxBlock, derivePathParams?: DerivePathParams) {
    tx = tx instanceof SuiTxBlock ? tx.txBlock : tx;
    return this.rpcProvider.provider.devInspectTransactionBlock({ transactionBlock: tx, sender: this.getAddress(derivePathParams) })
  }
}
