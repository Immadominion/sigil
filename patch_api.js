const fs = require("fs");
let code = fs.readFileSync("lib/api.ts", "utf8");

const withdrawMethod = `
  async withdraw(data: { amountSol?: number; botIds?: string[] }) {
    return this.request<{ success: boolean; txSignature: string; withdrawSol: number }>(
      "/api/wallet/withdraw",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }
`;

code = code.replace(
  '  async unlockWallet() {',
  withdrawMethod + '\n  async unlockWallet() {'
);

fs.writeFileSync("lib/api.ts", code);
