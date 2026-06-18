// Earn — supply DUSDC into the PLP vault. Clean raw-Coin round-trip (Gate 1).
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { CFG, type LoopVaultConfig } from "../config/loopvault.config";

export interface EarnSupplyArgs {
  amount: bigint; // DUSDC (6dp) to supply
  recipient: string; // receives the Coin<PLP>
}

export function buildEarnSupplyPTB(a: EarnSupplyArgs, cfg: LoopVaultConfig = CFG): Transaction {
  const tx = new Transaction();
  const lp = tx.moveCall({
    target: `${cfg.predictPkg}::predict::supply`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictSharedObj),
      coinWithBalance({ balance: a.amount, type: cfg.dusdcType }),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  tx.transferObjects([lp], tx.pure.address(a.recipient));
  return tx;
}
