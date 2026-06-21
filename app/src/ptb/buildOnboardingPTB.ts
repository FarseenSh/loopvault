// Onboarding — the linchpin tx. Creates the user's PredictManager (owner == the
// signer's zkLogin address, so deposit/mint's owner gates pass natively) and their
// Streak. Gasless via Enoki when connected with Google. create_manager shares the
// manager; streak::create transfers the Streak to the owner. We read both ids back
// from the tx's object changes.
import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { CFG, type LoopVaultConfig } from "../config/loopvault.config";

export interface OnboardingArgs {
  createManager: boolean;
  createStreak: boolean;
  owner: string;
}

export function buildOnboardingPTB(a: OnboardingArgs, cfg: LoopVaultConfig = CFG): Transaction {
  const tx = new Transaction();
  if (a.createManager) {
    // create_manager() shares a PredictManager owned (by field) by the sender.
    tx.moveCall({ target: `${cfg.predictPkg}::predict::create_manager` });
  }
  if (a.createStreak) {
    tx.moveCall({
      target: `${cfg.loopvaultPkg}::streak::create`,
      arguments: [tx.pure.address(a.owner), tx.object(SUI_CLOCK_OBJECT_ID)],
    });
  }
  return tx;
}
