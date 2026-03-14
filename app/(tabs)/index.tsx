import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  Alert,
  Image,
} from "react-native";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "../../lib/constants";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Shield, ShieldAlert, ShieldCheck, Unlink, Lock, Unlock, Copy, Download, Bot, Activity, ArrowRight, Wallet } from "lucide-react-native";
import { useAuthStore } from "../../stores/auth";
import { api, type Agent, type PendingApproval, type ActivityItem } from "../../lib/api";

const ACTIVITY_COLORS: Record<string, string> = {
  agent_registered: "#FF4500",
  agent_deregistered: "#f85149",
  session_created: "#3fb950",
  session_revoked: "#d29922",
  pairing_token_created: "#FF4500",
  pairing_token_revoked: "#d29922",
  agent_heartbeat: "#222222",
};

export default function Dashboard() {
  const { walletAddress, sealWalletAddress, token, logout } = useAuthStore();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [walletInfo, setWalletInfo] = useState<{
    onChain: boolean;
    isLocked: boolean;
  } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);
  const router = useRouter();

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [agentsData, walletData, approvals, activityData] = await Promise.all([
        api.listAgents(),
        api.getWallet(),
        api.getPendingApprovals().catch(() => [] as PendingApproval[]),
        api.getActivity(5).catch(() => [] as ActivityItem[]),
      ]);
      setAgents(agentsData);
      setWalletInfo({ onChain: walletData.onChain, isLocked: walletData.isLocked });
      setPendingApprovals(approvals);
      setActivity(activityData);

      if (walletData.sealWalletAddress) {
        try {
          const connection = new Connection(SOLANA_RPC_URL);
          const bal = await connection.getBalance(new PublicKey(walletData.sealWalletAddress));
          setBalance(bal / LAMPORTS_PER_SOL);
        } catch (e) { console.error("Balance fetch error:", e); }
      }
    } catch (err) {
      console.error("Failed to load dashboard:", err);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const activeAgents = agents.filter((a) => a.status === "active").length;

  const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const copyToClipboard = async (text: string, type: string) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS === "web") {
      window.alert(`${type} copied to clipboard!`);
    } else {
      Alert.alert("Copied", `${type} copied to clipboard`);
    }
  };

  const handleToggleLock = async () => {
    const isLocked = walletInfo?.isLocked ?? false;
    const doToggle = async () => {
      setTogglingLock(true);
      try {
        if (isLocked) await api.unlockWallet();
        else await api.lockWallet();
        await loadData();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      } finally {
        setTogglingLock(false);
      }
    };

    if (!isLocked) {
      const msg = "Lock wallet? New agent sessions will be blocked.";
      if (Platform.OS === "web") {
        if (window.confirm(msg)) doToggle();
      } else {
        Alert.alert("Lock Wallet", msg, [
          { text: "Cancel", style: "cancel" },
          { text: "Lock", style: "destructive", onPress: doToggle },
        ]);
      }
    } else {
      doToggle();
    }
  };

  const handleRevokeAll = () => {
    const doRevoke = async () => {
      setRevoking(true);
      try {
        const result = await api.revokeAllSessions();
        const msg = `Revoked ${result.sessionsRevoked} session(s) across ${result.agentsAffected} agent(s).`;
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Done", msg);
        await loadData();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to revoke";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      } finally {
        setRevoking(false);
      }
    };

    const confirmMsg = "Emergency: Revoke ALL active sessions for ALL agents? Cannot be undone.";
    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) doRevoke();
    } else {
      Alert.alert("Emergency Revoke", confirmMsg, [
        { text: "Cancel", style: "cancel" },
        { text: "Revoke All", style: "destructive", onPress: doRevoke },
      ]);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.approveSession(id);
      await loadData();
    } catch (err: any) {
      if (Platform.OS === "web") window.alert(err.message);
      else Alert.alert("Error", err.message);
    }
  };

  const handleReject = async (id: number) => {
    try {
      await api.rejectSession(id);
      await loadData();
    } catch (err: any) {
      if (Platform.OS === "web") window.alert(err.message);
      else Alert.alert("Error", err.message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#050505", alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: 640, flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF4500" />}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 20, paddingBottom: 20,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Image source={require("../../assets/images/logo.png")} style={{ width: 28, height: 28 }} resizeMode="contain" />
              <Text style={{ color: "#F5F5F5", fontSize: 22, fontWeight: "400", letterSpacing: 1, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" }}>Sigil</Text>
            </View>
            <Pressable
              onPress={logout}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: 12, paddingVertical: 8,
                backgroundColor: "#111111", borderRadius: 8,
                borderWidth: 1, borderColor: "#222222",
              }}
            >
              <Unlink size={14} color="#888888" />
              <Text style={{ color: "#888888", fontSize: 13, fontWeight: "600" }}>Disconnect</Text>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 20 }}>

            {/* Main Smart Wallet Card */}
            <View style={{
              backgroundColor: "#FF4500", borderRadius: 16,
              padding: 24, marginBottom: 20,
              shadowColor: "#FF4500", shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.15, shadowRadius: 24, elevation: 10
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "600", opacity: 0.9 }}>
                  Smart Wallet (PDA)
                </Text>
                <View style={{
                  backgroundColor: "rgba(0,0,0,0.2)",
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20
                }}>
                  <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>
                    {walletInfo?.isLocked ? "LOCKED" : (walletInfo?.onChain ? "ACTIVE" : "UNINITIALIZED")}
                  </Text>
                </View>
              </View>

              <Text style={{ color: "#FFFFFF", fontSize: 36, fontWeight: "800", letterSpacing: -1, marginBottom: 4 }}>
                {balance.toFixed(4)} <Text style={{ fontSize: 18, color: "rgba(255,255,255,0.7)" }}>SOL</Text>
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "SpaceMono", marginBottom: 8 }}>
                {sealWalletAddress ? short(sealWalletAddress) : "—"}
              </Text>

              <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
                <Pressable
                  onPress={() => sealWalletAddress && copyToClipboard(sealWalletAddress, "Wallet Address")}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 8, paddingVertical: 12
                  }}
                >
                  <Copy size={16} color="#FFF" />
                  <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "600" }}>Copy Address</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    sealWalletAddress && copyToClipboard(sealWalletAddress, "Address");
                    Alert.alert("Funding", "Please send SOL directly to your copied Smart Wallet PDA to fund your agents.");
                  }}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: "#FFFFFF", borderRadius: 8, paddingVertical: 12
                  }}
                >
                  <Download size={16} color="#FF4500" />
                  <Text style={{ color: "#FF4500", fontSize: 14, fontWeight: "600" }}>Fund Wallet</Text>
                </Pressable>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 30 }}>
              <Pressable
                onPress={handleToggleLock}
                disabled={togglingLock || !walletInfo?.onChain}
                style={{
                  flex: 1, padding: 16, borderRadius: 12,
                  backgroundColor: "#111111", borderWidth: 1, borderColor: walletInfo?.isLocked ? "#3fb950" : "#222222",
                  alignItems: "center"
                }}
              >
                {walletInfo?.isLocked ? <Unlock size={24} color="#3fb950" /> : <Lock size={24} color="#888888" />}
                <Text style={{ color: walletInfo?.isLocked ? "#3fb950" : "#888888", fontSize: 13, fontWeight: "600", marginTop: 8 }}>
                  {togglingLock ? "..." : (walletInfo?.isLocked ? "Unlock Access" : "Lock Wallet")}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleRevokeAll}
                disabled={revoking}
                style={{
                  flex: 1, padding: 16, borderRadius: 12,
                  backgroundColor: "#111111", borderWidth: 1, borderColor: "#222222",
                  alignItems: "center"
                }}
              >
                <ShieldAlert size={24} color="#f85149" />
                <Text style={{ color: "#f85149", fontSize: 13, fontWeight: "600", marginTop: 8 }}>
                  {revoking ? "..." : "Revoke All"}
                </Text>
              </Pressable>
            </View>

            {/* Pending Approvals */}
            {pendingApprovals.length > 0 && (
              <View style={{ marginBottom: 30 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Requests</Text>
                {pendingApprovals.map((req) => (
                  <View key={req.id} style={{
                    backgroundColor: "#111111", borderRadius: 12, padding: 16,
                    borderLeftWidth: 3, borderLeftColor: "#FF4500", marginBottom: 12
                  }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <View>
                        <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>{req.agent?.name}</Text>
                        <Text style={{ color: "#888888", fontSize: 13, marginTop: 2 }}>Wants to create a session</Text>
                      </View>
                      <Text style={{ color: "#444444", fontSize: 11 }}>Never expires</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => handleReject(req.id)}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "rgba(248,81,73,0.1)", alignItems: "center" }}
                      >
                        <Text style={{ color: "#f85149", fontSize: 13, fontWeight: "600" }}>Reject</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleApprove(req.id)}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#FF4500", alignItems: "center" }}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>Approve</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Agents Stats */}
            <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Overview</Text>
            <Pressable
              onPress={() => router.push("/(tabs)/agents")}
              style={{
                backgroundColor: "#111111", borderRadius: 12, padding: 20,
                flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                marginBottom: 12, borderWidth: 1, borderColor: "#222222"
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <View style={{ backgroundColor: "rgba(255,69,0,0.1)", padding: 12, borderRadius: 10 }}>
                  <Bot size={24} color="#FF4500" />
                </View>
                <View>
                  <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>Active Agents</Text>
                  <Text style={{ color: "#888888", fontSize: 13, marginTop: 2 }}>{activeAgents} agent connected</Text>
                </View>
              </View>
              <ArrowRight size={20} color="#444444" />
            </Pressable>

          </View>
        </ScrollView>
      </View>
    </View>
  );
}
