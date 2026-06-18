// Earn — burn PLP, withdraw DUSDC.
import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { CFG, type LoopVaultConfig } from "../config/loopvault.config";

export interface WithdrawArgs {
  lpCoinId: string; // the Coin<PLP> object to burn
  recipient: string; // receives the Coin<DUSDC>
}

export function buildWithdrawPTB(a: WithdrawArgs, cfg: LoopVaultConfig = CFG): Transaction {
  const tx = new Transaction();
  const out = tx.moveCall({
    target: `${cfg.predictPkg}::predict::withdraw`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictSharedObj),
      tx.object(a.lpCoinId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  tx.transferObjects([out], tx.pure.address(a.recipient));
  return tx;
}
