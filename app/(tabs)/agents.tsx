import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { api, type Agent } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { buildRegisterAgentTransaction } from "../../lib/seal";
import { getInjectedWebWalletProvider } from "../../lib/web-wallet";

const STATUS_COLOR: Record<string, string> = {
  active: "#3fb950",
  suspended: "#d29922",
  deregistered: "#f85149",
};

const STATUS_BG: Record<string, string> = {
  active: "rgba(63,185,80,0.12)",
  suspended: "rgba(210,153,34,0.12)",
  deregistered: "rgba(248,81,73,0.12)",
};

export default function AgentsScreen() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [autoApprove, setAutoApprove] = useState(true);
  const [dailyLimit, setDailyLimit] = useState("5");
  const [perTxLimit, setPerTxLimit] = useState("1");
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.listAgents();
      setAgents(data);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAgents();
    setRefreshing(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const agent = await api.createAgent({
        name: newName.trim(),
        autoApprove,
        dailyLimitSol: parseFloat(dailyLimit) || 5,
        perTxLimitSol: parseFloat(perTxLimit) || 1,
      });

      // Try on-chain registration — non-blocking if it fails
      const { walletAddress, walletProviderId } = useAuthStore.getState();
      const ownerAddress = walletAddress;
      if (ownerAddress && agent.agentPubkey) {
        registerAgentOnChain(ownerAddress, agent, walletProviderId).catch((e) =>
          console.warn("On-chain registration failed (can retry later):", e)
        );
      }

      setNewName("");
      setShowCreate(false);
      await loadAgents();
      router.push(`/agent/${agent.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create agent";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setCreating(false);
    }
  };

  const registerAgentOnChain = async (
    ownerAddress: string,
    agent: any,
    walletProviderId: string | null,
  ) => {
    const owner = new PublicKey(ownerAddress);
    const agentPubkey = new PublicKey(agent.agentPubkey);
    const LAMPORTS = BigInt(1_000_000_000);

    // Fund agent keypair with 0.05 SOL so it can pay for session creation rent + fees
    const AGENT_FUNDING = BigInt(Math.round(0.05 * Number(LAMPORTS)));

    const tx = await buildRegisterAgentTransaction({
      owner,
      agentPubkey,
      name: agent.name,
      dailyLimitLamports: BigInt(agent.dailyLimitLamports ?? 5n * LAMPORTS),
      perTxLimitLamports: BigInt(agent.perTxLimitLamports ?? 1n * LAMPORTS),
      allowedPrograms: [SystemProgram.programId],
      agentFundingLamports: AGENT_FUNDING,
    });

    if (Platform.OS === "web") {
      const provider = getInjectedWebWalletProvider(walletProviderId);
      if (!provider) {
        throw new Error("Selected wallet provider is unavailable. Reconnect the same wallet and try again.");
      }
      if (!provider.isConnected) await provider.connect();
      await provider.signAndSendTransaction(tx);
    } else {
      const { transact } = await import(
        "@solana-mobile/mobile-wallet-adapter-protocol-web3js"
      );
      await transact(async (wallet: any) => {
        await wallet.authorize({
          identity: { name: "Sigil", uri: "https://sigil.app", icon: "favicon.png" },
          cluster: "devnet",
        });
        await wallet.signAndSendTransactions({
          transactions: [tx.serialize({ requireAllSignatures: false })],
        });
      });
    }
  };

  const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <ScrollView contentContainerStyle={{ maxWidth: 640, width: "100%", alignSelf: "center", paddingBottom: 40 }}
      style={{ flex: 1, backgroundColor: "#050505" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF4500" />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}>

        {/* ── Create button / form ── */}
        {!showCreate ? (
          <Pressable
            onPress={() => setShowCreate(true)}
            style={{
              backgroundColor: "#FF4500", borderRadius: 6,
              paddingVertical: 14, alignItems: "center", marginBottom: 20,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>+ Register New Agent</Text>
          </Pressable>
        ) : (
          <View style={{
            backgroundColor: "#111111", borderRadius: 6,
            borderWidth: 1, borderColor: "#222222",
            padding: 18, marginBottom: 20,
          }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, marginBottom: 14 }}>New Agent</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g., LP Trading Bot"
              placeholderTextColor="#444444"
              style={{
                backgroundColor: "#050505",
                borderWidth: 1, borderColor: "#222222",
                borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12,
                color: "#fff", fontSize: 15, marginBottom: 12,
              }}
              maxLength={32}
              autoFocus
            />

            {/* Auto-approve toggle */}
            <Pressable
              onPress={() => setAutoApprove(!autoApprove)}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                backgroundColor: "#050505", borderWidth: 1, borderColor: "#222222",
                borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#F5F5F5", fontSize: 14, fontWeight: "600" }}>Auto-approve sessions</Text>
                <Text style={{ color: "#6e7681", fontSize: 11, marginTop: 2 }}>
                  {autoApprove ? "Agent gets sessions instantly — no manual approval" : "You must approve each session request in this app"}
                </Text>
              </View>
              <View style={{
                width: 44, height: 24, borderRadius: 12,
                backgroundColor: autoApprove ? "#3fb950" : "#222222",
                justifyContent: "center",
                paddingHorizontal: 2,
              }}>
                <View style={{
                  width: 20, height: 20, borderRadius: 10,
                  backgroundColor: "#fff",
                  alignSelf: autoApprove ? "flex-end" : "flex-start",
                }} />
              </View>
            </Pressable>

            {/* Spending limits */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#888888", fontSize: 11, marginBottom: 4, fontWeight: "600" }}>Daily Limit (SOL)</Text>
                <TextInput
                  value={dailyLimit}
                  onChangeText={setDailyLimit}
                  placeholder="5"
                  placeholderTextColor="#444444"
                  keyboardType="decimal-pad"
                  style={{
                    backgroundColor: "#050505", borderWidth: 1, borderColor: "#222222",
                    borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12,
                    color: "#fff", fontSize: 15,
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#888888", fontSize: 11, marginBottom: 4, fontWeight: "600" }}>Per TX Limit (SOL)</Text>
                <TextInput
                  value={perTxLimit}
                  onChangeText={setPerTxLimit}
                  placeholder="1"
                  placeholderTextColor="#444444"
                  keyboardType="decimal-pad"
                  style={{
                    backgroundColor: "#050505", borderWidth: 1, borderColor: "#222222",
                    borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12,
                    color: "#fff", fontSize: 15,
                  }}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => { setShowCreate(false); setNewName(""); setAutoApprove(true); setDailyLimit("5"); setPerTxLimit("1"); }}
                style={{
                  flex: 1, paddingVertical: 11, borderRadius: 6,
                  alignItems: "center", borderWidth: 1, borderColor: "#222222",
                }}
              >
                <Text style={{ color: "#888888", fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={creating || !newName.trim()}
                style={{
                  flex: 1, paddingVertical: 11, borderRadius: 6, alignItems: "center",
                  backgroundColor: creating || !newName.trim() ? "rgba(88,166,255,0.4)" : "#FF4500",
                }}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Create</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Agent List ── */}
        {agents.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <Text style={{ fontSize: 42, marginBottom: 14 }}>🤖</Text>
            <Text style={{ color: "#888888", fontSize: 15, fontWeight: "600", marginBottom: 6 }}>
              No agents yet
            </Text>
            <Text style={{ color: "#444444", fontSize: 13, textAlign: "center" }}>
              Register your first agent to start{"\n"}delegating trading authority
            </Text>
          </View>
        ) : (
          agents.map((agent) => (
            <Pressable
              key={agent.id}
              onPress={() => router.push(`/agent/${agent.id}`)}
              style={{
                backgroundColor: "#111111", borderRadius: 6,
                borderWidth: 1, borderColor: "#222222",
                padding: 16, marginBottom: 10,
              }}
            >
              {/* Row 1: name + status badge */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#F5F5F5", fontSize: 15, fontWeight: "700", flex: 1 }}>{agent.name}</Text>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                  backgroundColor: STATUS_BG[agent.status] ?? "rgba(100,116,139,0.12)",
                }}>
                  <Text style={{
                    fontSize: 11, fontWeight: "600", textTransform: "capitalize",
                    color: STATUS_COLOR[agent.status] ?? "#888888",
                  }}>
                    {agent.status}
                  </Text>
                </View>
              </View>

              {/* Row 2: pubkey */}
              <Text style={{ color: "#444444", fontSize: 11, fontFamily: "SpaceMono", marginBottom: 10 }}>
                {short(agent.agentPubkey)}
              </Text>

              {/* Row 3: sessions + limits */}
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View>
                  <Text style={{ color: "#6e7681", fontSize: 10, marginBottom: 2 }}>Sessions</Text>
                  <Text style={{ color: "#888888", fontSize: 13, fontWeight: "600" }}>
                    {agent.sessions?.filter((s) => s.isActive).length ?? 0} active
                  </Text>
                </View>
                <View>
                  <Text style={{ color: "#6e7681", fontSize: 10, marginBottom: 2 }}>Daily Limit</Text>
                  <Text style={{ color: "#888888", fontSize: 13, fontWeight: "600" }}>
                    {(Number(agent.dailyLimitLamports) / 1e9).toFixed(1)} SOL
                  </Text>
                </View>
                <View>
                  <Text style={{ color: "#6e7681", fontSize: 10, marginBottom: 2 }}>Per Tx</Text>
                  <Text style={{ color: "#888888", fontSize: 13, fontWeight: "600" }}>
                    {(Number(agent.perTxLimitLamports) / 1e9).toFixed(2)} SOL
                  </Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}
