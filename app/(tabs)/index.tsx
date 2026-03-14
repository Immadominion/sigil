import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../stores/auth";
import { api, type Agent, type PendingApproval, type ActivityItem } from "../../lib/api";

const ACTIVITY_LABELS: Record<string, string> = {
  agent_registered: "Agent Registered",
  agent_deregistered: "Agent Deregistered",
  session_created: "Session Created",
  session_revoked: "Session Revoked",
  pairing_token_created: "Pairing Token Created",
  pairing_token_revoked: "Pairing Token Revoked",
  agent_heartbeat: "Agent Heartbeat",
};

const ACTIVITY_COLORS: Record<string, string> = {
  agent_registered: "#58a6ff",
  agent_deregistered: "#f85149",
  session_created: "#3fb950",
  session_revoked: "#d29922",
  pairing_token_created: "#58a6ff",
  pairing_token_revoked: "#d29922",
  agent_heartbeat: "#30363d",
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
  const activeSessions = agents.reduce(
    (sum, a) => sum + (a.sessions?.filter((s) => s.isActive).length ?? 0),
    0
  );
  const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
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
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0d1117" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#58a6ff" />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ── */}
      <View style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 20, lineHeight: 24 }}>⬡</Text>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", letterSpacing: -0.5 }}>Sigil</Text>
        </View>
        <Pressable
          onPress={logout}
          style={{
            paddingHorizontal: 14, paddingVertical: 7,
            backgroundColor: "#161b22", borderRadius: 6,
            borderWidth: 1, borderColor: "#30363d",
          }}
        >
          <Text style={{ color: "#8b949e", fontSize: 12, fontWeight: "600" }}>Disconnect</Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 40 }}>

        {/* ── Wallet Card ── */}
        <View style={{
          backgroundColor: "#161b22", borderRadius: 6,
          borderWidth: 1, borderColor: "#30363d",
          padding: 20, marginBottom: 14,
        }}>
          {/* Card header row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <Text style={{ color: "#484f58", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "600" }}>
              Seal Wallet
            </Text>
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 5,
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
              backgroundColor: walletInfo?.isLocked
                ? "rgba(210,153,34,0.12)"
                : walletInfo?.onChain
                  ? "rgba(63,185,80,0.12)"
                  : "rgba(210,153,34,0.12)",
            }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: walletInfo?.isLocked
                  ? "#d29922"
                  : walletInfo?.onChain
                    ? "#3fb950"
                    : "#d29922",
              }} />
              <Text style={{
                fontSize: 11, fontWeight: "600",
                color: walletInfo?.isLocked
                  ? "#d29922"
                  : walletInfo?.onChain
                    ? "#3fb950"
                    : "#d29922",
              }}>
                {walletInfo?.isLocked ? "Locked" : walletInfo?.onChain ? "Active" : "Not Initialized"}
              </Text>
            </View>
          </View>

          {/* Address */}
          <Text style={{
            color: "#e6edf3", fontSize: 22, fontWeight: "700",
            fontFamily: "SpaceMono", letterSpacing: -0.5, marginBottom: 4,
          }}>
            {walletAddress ? short(walletAddress) : "—"}
          </Text>
          {sealWalletAddress && (
            <Text style={{ color: "#484f58", fontSize: 11, fontFamily: "SpaceMono", marginBottom: 18 }}>
              Seal: {short(sealWalletAddress)}
            </Text>
          )}

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: "#30363d", marginBottom: 16 }} />

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={handleToggleLock}
              disabled={togglingLock || !walletInfo?.onChain}
              style={{
                flex: 1, paddingVertical: 11, borderRadius: 6, alignItems: "center",
                borderWidth: 1,
                borderColor: walletInfo?.isLocked ? "rgba(63,185,80,0.35)" : "rgba(210,153,34,0.35)",
                backgroundColor: walletInfo?.isLocked ? "rgba(63,185,80,0.07)" : "rgba(210,153,34,0.07)",
                opacity: (togglingLock || !walletInfo?.onChain) ? 0.4 : 1,
              }}
            >
              <Text style={{
                fontSize: 12, fontWeight: "600",
                color: walletInfo?.isLocked ? "#3fb950" : "#d29922",
              }}>
                {togglingLock ? "•••" : walletInfo?.isLocked ? "🔓 Unlock" : "🔒 Lock"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleRevokeAll}
              disabled={revoking}
              style={{
                flex: 1, paddingVertical: 11, borderRadius: 6, alignItems: "center",
                borderWidth: 1, borderColor: "rgba(248,81,73,0.3)",
                backgroundColor: "rgba(248,81,73,0.06)",
                opacity: revoking ? 0.4 : 1,
              }}
            >
              <Text style={{ color: "#f85149", fontSize: 12, fontWeight: "600" }}>
                {revoking ? "•••" : "🚨 Revoke All"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ── Stats Row ── */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Agents", value: agents.length, warn: false },
            { label: "Active", value: activeAgents, warn: false },
            { label: "Sessions", value: activeSessions, warn: false },
            { label: "Pending", value: pendingApprovals.length, warn: pendingApprovals.length > 0 },
          ].map((stat) => (
            <View key={stat.label} style={{
              flex: 1, backgroundColor: "#161b22", borderRadius: 6,
              borderWidth: 1,
              borderColor: stat.warn && stat.value > 0 ? "rgba(210,153,34,0.3)" : "#30363d",
              paddingVertical: 16, alignItems: "center",
            }}>
              <Text style={{
                fontSize: 24, fontWeight: "700",
                color: stat.warn && stat.value > 0 ? "#d29922" : "#e6edf3",
              }}>
                {stat.value}
              </Text>
              <Text style={{ color: "#6e7681", fontSize: 10, marginTop: 3, fontWeight: "500" }}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Pending Approvals ── */}
        {pendingApprovals.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700", marginBottom: 10 }}>
              Pending Approvals
            </Text>
            {pendingApprovals.map((approval) => (
              <View key={approval.id} style={{
                backgroundColor: "rgba(210,153,34,0.05)",
                borderRadius: 6, borderWidth: 1, borderColor: "rgba(210,153,34,0.2)",
                padding: 16, marginBottom: 8,
              }}>
                <Text style={{ color: "#d29922", fontSize: 14, fontWeight: "600", marginBottom: 4 }}>
                  {approval.agent?.name ?? `Agent #${approval.agentId}`}
                </Text>
                <Text style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}>
                  Requesting session approval
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => handleApprove(approval.id)}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: "center",
                      backgroundColor: "rgba(63,185,80,0.12)",
                      borderWidth: 1, borderColor: "rgba(63,185,80,0.3)",
                    }}
                  >
                    <Text style={{ color: "#3fb950", fontSize: 13, fontWeight: "600" }}>Approve</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleReject(approval.id)}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: "center",
                      backgroundColor: "rgba(248,81,73,0.08)",
                      borderWidth: 1, borderColor: "rgba(248,81,73,0.25)",
                    }}
                  >
                    <Text style={{ color: "#f85149", fontSize: 13, fontWeight: "600" }}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Agents Section ── */}
        <View style={{ marginBottom: 20 }}>
          <View style={{
            flexDirection: "row", alignItems: "center",
            justifyContent: "space-between", marginBottom: 10,
          }}>
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Agents</Text>
            <Pressable onPress={() => router.push("/(tabs)/agents")}>
              <Text style={{ color: "#58a6ff", fontSize: 12, fontWeight: "600" }}>View All →</Text>
            </Pressable>
          </View>

          {agents.length === 0 ? (
            <View style={{
              backgroundColor: "#161b22", borderRadius: 6,
              borderWidth: 1, borderColor: "#30363d",
              padding: 24, alignItems: "center",
            }}>
              <Text style={{ color: "#8b949e", fontSize: 14, marginBottom: 6 }}>No agents yet</Text>
              <Text style={{ color: "#484f58", fontSize: 12, marginBottom: 16, textAlign: "center" }}>
                Register your first AI agent to get started
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/agents")}
                style={{
                  paddingHorizontal: 20, paddingVertical: 10,
                  backgroundColor: "rgba(88,166,255,0.1)", borderRadius: 6,
                  borderWidth: 1, borderColor: "rgba(88,166,255,0.3)",
                }}
              >
                <Text style={{ color: "#58a6ff", fontSize: 13, fontWeight: "600" }}>
                  Register Agent
                </Text>
              </Pressable>
            </View>
          ) : (
            agents.slice(0, 3).map((agent) => (
              <Pressable
                key={agent.id}
                onPress={() => router.push(`/agent/${agent.id}`)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  backgroundColor: "#161b22", borderRadius: 6,
                  borderWidth: 1, borderColor: "#30363d",
                  padding: 14, marginBottom: 8,
                }}
              >
                <View style={{
                  width: 10, height: 10, borderRadius: 5, flexShrink: 0,
                  backgroundColor:
                    agent.status === "active"
                      ? "#3fb950"
                      : agent.status === "suspended"
                        ? "#f85149"
                        : "#484f58",
                }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#e6edf3", fontSize: 14, fontWeight: "600" }}>{agent.name}</Text>
                  <Text style={{ color: "#6e7681", fontSize: 11, marginTop: 2 }}>
                    {agent.sessions?.filter((s) => s.isActive).length ?? 0} active session
                    {(agent.sessions?.filter((s) => s.isActive).length ?? 0) !== 1 ? "s" : ""}
                  </Text>
                </View>
                <Text style={{ color: "#484f58", fontSize: 18, lineHeight: 22 }}>›</Text>
              </Pressable>
            ))
          )}
        </View>

        {/* ── Recent Activity ── */}
        <View>
          <View style={{
            flexDirection: "row", alignItems: "center",
            justifyContent: "space-between", marginBottom: 10,
          }}>
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Recent Activity</Text>
            <Pressable onPress={() => router.push("/(tabs)/activity")}>
              <Text style={{ color: "#58a6ff", fontSize: 12, fontWeight: "600" }}>View All →</Text>
            </Pressable>
          </View>

          <View style={{
            backgroundColor: "#161b22", borderRadius: 6,
            borderWidth: 1, borderColor: "#30363d",
            overflow: "hidden",
          }}>
            {activity.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ color: "#484f58", fontSize: 13 }}>No activity yet</Text>
              </View>
            ) : (
              activity.slice(0, 5).map((item, i) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#30363d",
                  }}
                >
                  <View style={{
                    width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                    backgroundColor: ACTIVITY_COLORS[item.action] ?? "#484f58",
                  }} />
                  <Text style={{ color: "#8b949e", fontSize: 13, flex: 1 }}>
                    {ACTIVITY_LABELS[item.action] ?? item.action}
                    {item.agent ? (
                      <Text style={{ color: "#6e7681" }}> · {item.agent.name}</Text>
                    ) : null}
                  </Text>
                  <Text style={{ color: "#484f58", fontSize: 11 }}>{formatTime(item.createdAt)}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
