export type WebWalletProviderId = "phantom" | "solflare" | "backpack" | "solana";

export function getWebWalletProviderId(walletName: string): WebWalletProviderId {
  const normalized = walletName.toLowerCase();

  if (normalized.includes("phantom")) return "phantom";
  if (normalized.includes("solflare")) return "solflare";
  if (normalized.includes("backpack") || normalized.includes("xnft")) return "backpack";

  return "solana";
}

export function getInjectedWebWalletProvider(walletProviderId?: string | null): any {
  if (typeof window === "undefined") return null;

  switch (walletProviderId) {
    case "phantom":
      return (window as any).phantom?.solana ?? null;
    case "solflare":
      return (window as any).solflare ?? null;
    case "backpack":
      return (window as any).xnft?.solana ?? (window as any).backpack ?? null;
    case "solana":
      return (window as any).solana ?? null;
    default:
      return null;
  }
}