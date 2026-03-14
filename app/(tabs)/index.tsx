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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { SOLANA_RPC_URL } from "../../lib/constants";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ShieldAlert, Unlink, Lock, Unlock, Copy, ArrowUpRight, Bot, ArrowRight, X } from "lucide-react-native";
import { useAuthStore } from "../../stores/auth";
import { getInjectedWebWalletProvider } from "../../lib/web-wallet";
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
  const { walletAddress, sealWalletAddress, token, logout, walletProviderId } = useAuthStore();
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
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMax, setWithdrawMax] = useState(false);
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

  const handleWithdraw = async () => {
    const amountSol = withdrawMax ? 0 : parseFloat(withdrawAmount);
    if (!withdrawMax && (isNaN(amountSol) || amountSol <= 0)) {
      const msg = "Please enter a valid amount.";
      Platform.OS === "web" ? window.alert(msg) : Alert.alert("Invalid", msg);
      return;
    }
    setWithdrawing(true);
    try {
      const result = await api.withdraw({ amountSol: withdrawMax ? 0 : amountSol });

      if (result.closesWallet) {
        const confirmMsg = `This will withdraw ALL ${result.totalAvailableSol} SOL and close your wallet PDA. Continue?`;
        const confirmed = Platform.OS === "web"
          ? window.confirm(confirmMsg)
          : await new Promise<boolean>((resolve) =>
            Alert.alert("Close Wallet?", confirmMsg, [
              { text: "Cancel", onPress: () => resolve(false), style: "cancel" },
              { text: "Withdraw All", onPress: () => resolve(true), style: "destructive" },
            ])
          );
        if (!confirmed) { setWithdrawing(false); return; }
      }

      // Sign the partially-signed TX with the user's wallet
      if (Platform.OS === "web") {
        const provider = getInjectedWebWalletProvider(walletProviderId);
        if (!provider) throw new Error("Wallet not connected. Please reconnect.");
        if (!provider.isConnected) await provider.connect();
        const txBytes = Buffer.from(result.transaction, "base64");
        const tx = Transaction.from(txBytes);
        const { signature } = await provider.signAndSendTransaction(tx);
        const sig = typeof signature === "string" ? signature : signature.toString();
        const msg = `Withdrew ${result.withdrawSol} SOL`;
        window.alert(msg);
      } else {
        // Native: submit via backend
        await api.submitSigned({ transaction: result.transaction });
        Alert.alert("Success", `Withdrew ${result.withdrawSol} SOL`);
      }

      setShowWithdraw(false);
      setWithdrawAmount("");
      setWithdrawMax(false);
      await loadData();
    } catch (err: any) {
      const msg = err?.message ?? "Withdraw failed";
      Platform.OS === "web" ? window.alert(msg) : Alert.alert("Error", msg);
    } finally {
      setWithdrawing(false);
    }
  };

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
      <View style={{ width: "100%", maxWidth: 640, flex: 1, marginTop: Platform.OS === 'ios' ? 60 : 100 }}>
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Image source={require("../../assets/images/logo.png")} style={{ width: 30, height: 30, borderRadius: 6 }} resizeMode="contain" />
              <Text style={{ color: "#F5F5F5", fontSize: 22, fontWeight: "300", letterSpacing: 2, fontFamily: Platform.select({ ios: "Baskerville", android: "serif", web: "'Playfair Display', Georgia, serif" }) }}>SIGIL</Text>
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
                  onPress={() => setShowWithdraw(true)}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: "#FFFFFF", borderRadius: 8, paddingVertical: 12
                  }}
                >
                  <ArrowUpRight size={16} color="#FF4500" />
                  <Text style={{ color: "#FF4500", fontSize: 14, fontWeight: "600" }}>Withdraw</Text>
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

        {/* Withdraw Modal */}
        <Modal
          visible={showWithdraw}
          transparent
          animationType="slide"
          onRequestClose={() => setShowWithdraw(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            <Pressable style={{ flex: 1 }} onPress={() => setShowWithdraw(false)} />
            <View style={{
              backgroundColor: "#111111", borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 24, paddingBottom: Platform.OS === "ios" ? 44 : 24,
              maxWidth: 640, width: "100%", alignSelf: "center",
            }}>
              {/* Modal Header */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <Text style={{ color: "#F5F5F5", fontSize: 20, fontWeight: "700" }}>Withdraw SOL</Text>
                <Pressable onPress={() => setShowWithdraw(false)} style={{ padding: 4 }}>
                  <X size={22} color="#888888" />
                </Pressable>
              </View>

              {/* Balance Display */}
              <View style={{ backgroundColor: "#0A0A0A", borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "#222222" }}>
                <Text style={{ color: "#888888", fontSize: 12, fontWeight: "600", marginBottom: 4 }}>AVAILABLE BALANCE</Text>
                <Text style={{ color: "#F5F5F5", fontSize: 28, fontWeight: "800" }}>
                  {balance.toFixed(4)} <Text style={{ fontSize: 14, color: "#888888" }}>SOL</Text>
                </Text>
              </View>

              {/* Amount Input */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: "#888888", fontSize: 12, fontWeight: "600", marginBottom: 8 }}>AMOUNT</Text>
                <View style={{
                  flexDirection: "row", alignItems: "center",
                  backgroundColor: "#0A0A0A", borderRadius: 10,
                  borderWidth: 1, borderColor: withdrawMax ? "#FF4500" : "#222222",
                  paddingHorizontal: 16,
                }}>
                  <TextInput
                    style={{
                      flex: 1, color: withdrawMax ? "#888888" : "#F5F5F5", fontSize: 20, fontWeight: "700",
                      paddingVertical: 14, fontFamily: "SpaceMono",
                    }}
                    placeholder="0.00"
                    placeholderTextColor="#444444"
                    keyboardType="decimal-pad"
                    value={withdrawMax ? balance.toFixed(4) : withdrawAmount}
                    onChangeText={(t) => { setWithdrawMax(false); setWithdrawAmount(t); }}
                    editable={!withdrawMax && !withdrawing}
                  />
                  <Text style={{ color: "#888888", fontSize: 14, fontWeight: "600", marginLeft: 8 }}>SOL</Text>
                </View>
              </View>

              {/* Quick Amount Buttons */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
                {[25, 50, 75].map((pct) => (
                  <Pressable
                    key={pct}
                    onPress={() => {
                      setWithdrawMax(false);
                      setWithdrawAmount((balance * pct / 100).toFixed(4));
                    }}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 8,
                      backgroundColor: "#0A0A0A", borderWidth: 1, borderColor: "#222222",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#888888", fontSize: 13, fontWeight: "600" }}>{pct}%</Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => { setWithdrawMax(true); setWithdrawAmount(""); }}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 8,
                    backgroundColor: withdrawMax ? "rgba(255,69,0,0.1)" : "#0A0A0A",
                    borderWidth: 1, borderColor: withdrawMax ? "#FF4500" : "#222222",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: withdrawMax ? "#FF4500" : "#888888", fontSize: 13, fontWeight: "700" }}>MAX</Text>
                </Pressable>
              </View>

              {/* Withdraw All Warning */}
              {withdrawMax && (
                <View style={{
                  backgroundColor: "rgba(255,69,0,0.08)", borderRadius: 8, padding: 12, marginBottom: 16,
                  borderWidth: 1, borderColor: "rgba(255,69,0,0.2)",
                }}>
                  <Text style={{ color: "#FF4500", fontSize: 12, lineHeight: 18 }}>
                    Withdrawing MAX will close your wallet PDA and deregister all agents. You can recreate them later.
                  </Text>
                </View>
              )}

              {/* Confirm Button */}
              <Pressable
                onPress={handleWithdraw}
                disabled={withdrawing || (!withdrawMax && !withdrawAmount)}
                style={{
                  backgroundColor: withdrawing || (!withdrawMax && !withdrawAmount) ? "#333333" : "#FF4500",
                  borderRadius: 10, paddingVertical: 16, alignItems: "center",
                  flexDirection: "row", justifyContent: "center", gap: 8,
                }}
              >
                {withdrawing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <ArrowUpRight size={18} color="#FFF" />
                )}
                <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                  {withdrawing ? "Processing..." : (withdrawMax ? "Withdraw All" : "Withdraw")}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </View>
  );
}
