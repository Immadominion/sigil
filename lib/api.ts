import { API_BASE_URL } from "./constants";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Request failed" }));
      throw new Error(error.error ?? `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ═══════════════════════════════════════════════════════════
  // Auth
  // ═══════════════════════════════════════════════════════════
  async getNonce(walletAddress: string) {
    return this.request<{ nonce: string; expiresAt: string }>(
      `/api/auth/nonce?walletAddress=${encodeURIComponent(walletAddress)}`
    );
  }

  async verify(data: {
    walletAddress: string;
    nonce: string;
    signature: string;
    message: string;
  }) {
    return this.request<{
      token: string;
      wallet: { id: number; ownerAddress: string; sealWalletAddress: string };
    }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Wallet
  // ═══════════════════════════════════════════════════════════
  async getWallet() {
    return this.request<{
      id: number;
      ownerAddress: string;
      sealWalletAddress: string;
      label: string | null;
      isLocked: boolean;
      onChain: boolean;
    }>("/api/wallet");
  }

  async lockWallet() {
    return this.request<{ success: boolean; isLocked: boolean }>(
      "/api/wallet/lock",
      { method: "POST" }
    );
  }


  async withdraw(data: { amountSol?: number }) {
    return this.request<{
      success: boolean;
      transaction: string;
      network: string;
      withdrawSol: number;
      totalAvailableSol: number;
      walletPdaSol: number;
      closesWallet: boolean;
      details: { agent: string; sol: number }[];
      blockhash: string;
      lastValidBlockHeight: number;
    }>("/api/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getBalance() {
    return this.request<{
      success: boolean;
      lamports: number;
      sol: number;
      walletLamports: number;
      sessionLamports: number;
    }>("/api/wallet/balance");
  }

  async submitSigned(data: { transaction: string; setupLiveBotId?: string; recoverWalletClose?: boolean }) {
    return this.request<{ success: boolean; signature: string }>(
      "/api/wallet/submit-signed",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async unlockWallet() {
    return this.request<{ success: boolean; isLocked: boolean }>(
      "/api/wallet/unlock",
      { method: "POST" }
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Agents
  // ═══════════════════════════════════════════════════════════
  async listAgents() {
    return this.request<Agent[]>("/api/agents");
  }

  async getAgent(id: number) {
    return this.request<Agent & { onChain: boolean }>(`/api/agents/${id}`);
  }

  async createAgent(data: {
    name: string;
    allowedPrograms?: string[];
    autoApprove?: boolean;
    dailyLimitSol?: number;
    perTxLimitSol?: number;
  }) {
    return this.request<Agent>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAgent(
    id: number,
    data: {
      name?: string;
      autoApprove?: boolean;
      dailyLimitSol?: number;
      perTxLimitSol?: number;
      status?: "active" | "suspended";
    }
  ) {
    return this.request<Agent>(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: number) {
    return this.request<{ success: boolean }>(`/api/agents/${id}`, {
      method: "DELETE",
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Pairing Tokens
  // ═══════════════════════════════════════════════════════════
  async createPairingToken(
    agentId: number,
    data: { label?: string; expiresInDays?: number }
  ) {
    return this.request<{
      id: number;
      token: string;
      label: string;
      expiresAt: string;
      warning: string;
    }>(`/api/agents/${agentId}/pairing`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listPairingTokens(agentId: number) {
    return this.request<PairingToken[]>(`/api/agents/${agentId}/pairing`);
  }

  async revokePairingToken(agentId: number, tokenId: number) {
    return this.request<{ success: boolean }>(
      `/api/agents/${agentId}/pairing/${tokenId}`,
      { method: "DELETE" }
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Activity
  // ═══════════════════════════════════════════════════════════
  async getActivity(limit = 50, offset = 0) {
    return this.request<ActivityItem[]>(
      `/api/activity?limit=${limit}&offset=${offset}`
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Session Revocation
  // ═══════════════════════════════════════════════════════════
  async revokeAgentSessions(agentId: number) {
    return this.request<{ success: boolean; revokedCount: number }>(
      `/api/agents/${agentId}/revoke-sessions`,
      { method: "POST" }
    );
  }

  async revokeAllSessions() {
    return this.request<{
      success: boolean;
      agentsAffected: number;
      sessionsRevoked: number;
    }>("/api/wallet/revoke-all", { method: "POST" });
  }

  // ═══════════════════════════════════════════════════════════
  // Approval Queue
  // ═══════════════════════════════════════════════════════════
  async getPendingApprovals() {
    return this.request<PendingApproval[]>("/api/agents/approvals");
  }

  async approveSession(approvalId: number) {
    return this.request<{ success: boolean }>(`/api/agents/approvals/${approvalId}/approve`, {
      method: "POST",
    });
  }

  async rejectSession(approvalId: number) {
    return this.request<{ success: boolean }>(`/api/agents/approvals/${approvalId}/reject`, {
      method: "POST",
    });
  }
}

// Types
export interface Agent {
  id: number;
  walletId: number;
  agentPubkey: string;
  agentConfigPda: string;
  name: string;
  allowedPrograms: string[];
  autoApprove: boolean;
  dailyLimitLamports: string;
  perTxLimitLamports: string;
  status: "active" | "suspended" | "deregistered";
  createdAt: string;
  pairingTokens?: PairingToken[];
  sessions?: Session[];
}

export interface PairingToken {
  id: number;
  label: string;
  expiresAt: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Session {
  id: number;
  sessionPda: string;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface ActivityItem {
  id: number;
  walletId: number;
  agentId: number | null;
  action: string;
  details: Record<string, unknown> | null;
  txSignature: string | null;
  createdAt: string;
  agent?: { id: number; name: string; agentPubkey: string } | null;
}

export interface PendingApproval {
  id: number;
  agentId: number;
  walletId: number;
  durationSecs: number;
  maxAmountLamports: number;
  maxPerTxLamports: number;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  agent?: { id: number; name: string; agentPubkey: string };
}

export const api = new ApiClient();
