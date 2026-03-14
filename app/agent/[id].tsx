import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { api, type Agent, type PairingToken } from "../../lib/api";

export default function AgentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<(Agent & { onChain: boolean }) | null>(
    null
  );
  const [pairingTokens, setPairingTokens] = useState<PairingToken[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const router = useRouter();

  const agentId = parseInt(id);

  const loadAgent = useCallback(async () => {
    try {
      const [agentData, tokens] = await Promise.all([
        api.getAgent(agentId),
        api.listPairingTokens(agentId),
      ]);
      setAgent(agentData);
      setPairingTokens(tokens);
    } catch (err) {
      console.error("Failed to load agent:", err);
    }
  }, [agentId]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    try {
      const result = await api.createPairingToken(agentId, {
        label: `Token ${pairingTokens.length + 1}`,
      });
      setNewToken(result.token);
      await loadAgent();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to generate token";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleCopyToken = async () => {
    if (!newToken) return;
    if (Platform.OS === "web") {
      await navigator.clipboard.writeText(newToken);
      window.alert("Token copied to clipboard!");
    } else {
      await Share.share({ message: newToken });
    }
  };

  const handleRevokeToken = async (tokenId: number) => {
    const doRevoke = async () => {
      try {
        await api.revokePairingToken(agentId, tokenId);
        await loadAgent();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to revoke token";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm("Revoke this pairing token? Agents using it will lose access.")) {
        await doRevoke();
      }
    } else {
      Alert.alert(
        "Revoke Token",
        "Agents using this token will lose access.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Revoke", style: "destructive", onPress: doRevoke },
        ]
      );
    }
  };

  const handleSuspend = async () => {
    if (!agent) return;
    const newStatus = agent.status === "active" ? "suspended" : "active";
    try {
      await api.updateAgent(agentId, { status: newStatus as "active" | "suspended" });
      await loadAgent();
    } catch (err) {
      console.error("Failed to update agent:", err);
    }
  };

  const handleRevokeSessions = () => {
    const doRevoke = async () => {
      setRevokingSessions(true);
      try {
        const result = await api.revokeAgentSessions(agentId);
        const msg = `Revoked ${result.revokedCount} session(s).`;
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Sessions Revoked", msg);
        await loadAgent();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to revoke sessions";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      } finally {
        setRevokingSessions(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm("Revoke all active sessions for this agent?")) {
        doRevoke();
      }
    } else {
      Alert.alert(
        "Revoke Sessions",
        "All active sessions for this agent will be immediately revoked.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Revoke", style: "destructive", onPress: doRevoke },
        ]
      );
    }
  };

  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  const formatLamports = (lamports: string) => {
    const sol = parseInt(lamports) / 1e9;
    return `${sol.toFixed(2)} SOL`;
  };

  if (!agent) {
    return (
      <View className="flex-1 bg-sigil-bg items-center justify-center">
        <Text className="text-sigil-muted">Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-sigil-bg">
      <View className="px-5 pt-4 pb-8">
        {/* Agent Header */}
        <View className="bg-sigil-surface border border-sigil-border rounded-2xl p-5 mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white text-xl font-bold">{agent.name}</Text>
            <View
              className={`flex-row items-center gap-1.5 px-3 py-1 rounded-full ${
                agent.status === "active"
                  ? "bg-sigil-success/20"
                  : "bg-sigil-warning/20"
              }`}
            >
              <View
                className={`w-2 h-2 rounded-full ${
                  agent.status === "active"
                    ? "bg-sigil-success"
                    : "bg-sigil-warning"
                }`}
              />
              <Text
                className={`text-xs font-medium capitalize ${
                  agent.status === "active"
                    ? "text-sigil-success"
                    : "text-sigil-warning"
                }`}
              >
                {agent.status}
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <View className="flex-row justify-between">
              <Text className="text-sigil-muted text-sm">Agent Pubkey</Text>
              <Text className="text-white text-sm font-mono">
                {shortenAddress(agent.agentPubkey)}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sigil-muted text-sm">On-chain</Text>
              <Text
                className={`text-sm font-medium ${
                  agent.onChain ? "text-sigil-success" : "text-sigil-warning"
                }`}
              >
                {agent.onChain ? "Registered" : "Pending"}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sigil-muted text-sm">Daily Limit</Text>
              <Text className="text-white text-sm">
                {formatLamports(agent.dailyLimitLamports)}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sigil-muted text-sm">Per-TX Limit</Text>
              <Text className="text-white text-sm">
                {formatLamports(agent.perTxLimitLamports)}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sigil-muted text-sm">Auto-approve</Text>
              <Text className="text-white text-sm">
                {agent.autoApprove ? "Yes" : "No"}
              </Text>
            </View>
          </View>
        </View>

        {/* Pairing Tokens Section */}
        <View className="mb-4">
          <Text className="text-white text-lg font-semibold mb-3">
            Pairing Tokens
          </Text>

          {/* New Token Display */}
          {newToken && (
            <View className="bg-sigil-accent/10 border border-sigil-accent rounded-2xl p-5 mb-3">
              <Text className="text-sigil-accent font-semibold mb-2">
                New Pairing Token Created
              </Text>
              <View className="items-center my-4">
                <View className="bg-white p-3 rounded-xl">
                  <QRCode
                    value={newToken}
                    size={200}
                    backgroundColor="white"
                    color="#0B0E17"
                  />
                </View>
                <Text className="text-sigil-muted text-xs mt-2">
                  Scan with agent to pair
                </Text>
              </View>
              <Text className="text-white font-mono text-sm mb-3 break-all">
                {newToken}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={handleCopyToken}
                  className="flex-1 bg-sigil-accent rounded-xl py-3 items-center"
                >
                  <Text className="text-white font-medium">Copy Token</Text>
                </Pressable>
                <Pressable
                  onPress={() => setNewToken(null)}
                  className="border border-sigil-border rounded-xl px-4 py-3 items-center"
                >
                  <Text className="text-sigil-muted">Done</Text>
                </Pressable>
              </View>
              <Text className="text-sigil-warning text-xs mt-3">
                ⚠ Save this token now — it cannot be retrieved again.
              </Text>
            </View>
          )}

          {/* Generate Token Button */}
          <Pressable
            onPress={handleGenerateToken}
            disabled={generatingToken}
            className={`border border-sigil-accent rounded-2xl p-4 items-center mb-3 ${
              generatingToken ? "opacity-50" : ""
            }`}
          >
            <Text className="text-sigil-accent font-medium">
              {generatingToken ? "Generating..." : "+ Generate Pairing Token"}
            </Text>
          </Pressable>

          {/* Token List */}
          {pairingTokens.map((token) => (
            <View
              key={token.id}
              className="bg-sigil-surface border border-sigil-border rounded-xl p-4 mb-2 flex-row items-center justify-between"
            >
              <View>
                <Text className="text-white text-sm">{token.label}</Text>
                <Text className="text-sigil-muted text-xs mt-1">
                  Expires: {new Date(token.expiresAt).toLocaleDateString()}
                </Text>
                {token.lastUsedAt && (
                  <Text className="text-sigil-muted text-xs">
                    Last used:{" "}
                    {new Date(token.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              {!token.revoked ? (
                <Pressable
                  onPress={() => handleRevokeToken(token.id)}
                  className="bg-sigil-danger/20 px-3 py-1.5 rounded-lg"
                >
                  <Text className="text-sigil-danger text-xs font-medium">
                    Revoke
                  </Text>
                </Pressable>
              ) : (
                <Text className="text-sigil-muted text-xs">Revoked</Text>
              )}
            </View>
          ))}
        </View>

        {/* Actions */}
        <View className="gap-3">
          {/* Revoke Sessions */}
          {(agent.sessions?.filter((s) => s.isActive).length ?? 0) > 0 && (
            <Pressable
              onPress={handleRevokeSessions}
              disabled={revokingSessions}
              className={`rounded-2xl p-4 items-center border ${
                revokingSessions
                  ? "border-sigil-danger/30 bg-sigil-danger/5"
                  : "border-sigil-danger/50 bg-sigil-danger/10"
              }`}
            >
              <Text
                className={`font-medium ${
                  revokingSessions
                    ? "text-sigil-danger/50"
                    : "text-sigil-danger"
                }`}
              >
                {revokingSessions
                  ? "Revoking..."
                  : `Revoke All Sessions (${agent.sessions?.filter((s) => s.isActive).length})`}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleSuspend}
            className={`rounded-2xl p-4 items-center ${
              agent.status === "active"
                ? "bg-sigil-warning/20 border border-sigil-warning/30"
                : "bg-sigil-success/20 border border-sigil-success/30"
            }`}
          >
            <Text
              className={`font-medium ${
                agent.status === "active"
                  ? "text-sigil-warning"
                  : "text-sigil-success"
              }`}
            >
              {agent.status === "active" ? "Suspend Agent" : "Reactivate Agent"}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
