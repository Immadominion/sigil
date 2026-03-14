import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
} from "react-native";
import { api, type ActivityItem } from "../../lib/api";

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  agent_registered:       { label: "Agent Registered",        color: "#58a6ff", icon: "📋" },
  agent_deregistered:     { label: "Agent Deregistered",      color: "#f85149", icon: "🗑" },
  session_created:        { label: "Session Created",         color: "#3fb950", icon: "🔓" },
  session_revoked:        { label: "Session Revoked",         color: "#d29922", icon: "🔒" },
  pairing_token_created:  { label: "Pairing Token Created",   color: "#58a6ff", icon: "🔗" },
  pairing_token_revoked:  { label: "Pairing Token Revoked",   color: "#d29922", icon: "✂" },
  agent_heartbeat:        { label: "Agent Heartbeat",         color: "#30363d", icon: "💓" },
};

export default function ActivityScreen() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [limit, setLimit] = useState(50);

  const loadActivity = useCallback(async () => {
    try {
      const data = await api.getActivity(limit);
      setActivity(data);
    } catch (err) {
      console.error("Failed to load activity:", err);
    }
  }, [limit]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadActivity();
    setRefreshing(false);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#0d1117" }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#58a6ff" />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}>
        {activity.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 80 }}>
            <Text style={{ fontSize: 42, marginBottom: 14 }}>📭</Text>
            <Text style={{ color: "#8b949e", fontSize: 15, fontWeight: "600", marginBottom: 6 }}>
              No activity yet
            </Text>
            <Text style={{ color: "#484f58", fontSize: 13 }}>Events will appear here as agents run</Text>
          </View>
        ) : (
          <View style={{
            backgroundColor: "#161b22", borderRadius: 6,
            borderWidth: 1, borderColor: "#30363d", overflow: "hidden",
          }}>
            {activity.map((item, i) => {
              const meta = ACTION_META[item.action] ?? { label: item.action, color: "#484f58", icon: "·" };
              return (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row", alignItems: "flex-start", gap: 12,
                    paddingHorizontal: 16, paddingVertical: 14,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#30363d",
                  }}
                >
                  {/* Icon badge */}
                  <View style={{
                    width: 32, height: 32, borderRadius: 8,
                    backgroundColor: meta.color + "18",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <Text style={{ fontSize: 14 }}>{meta.icon}</Text>
                  </View>

                  {/* Content */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#c9d1d9", fontSize: 13, fontWeight: "500", marginBottom: 2 }}>
                      {meta.label}
                    </Text>
                    {item.agent && (
                      <Text style={{ color: "#6e7681", fontSize: 11 }}>{item.agent.name}</Text>
                    )}
                    {item.txSignature && (
                      <Text style={{ color: "#484f58", fontSize: 10, fontFamily: "SpaceMono", marginTop: 2 }}>
                        {item.txSignature.slice(0, 12)}...
                      </Text>
                    )}
                  </View>

                  {/* Time */}
                  <Text style={{ color: "#484f58", fontSize: 11, marginTop: 2 }}>{formatTime(item.createdAt)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Load more */}
        {activity.length >= limit && (
          <Pressable
            onPress={() => setLimit((l) => l + 50)}
            style={{
              marginTop: 16, paddingVertical: 12, alignItems: "center",
              borderRadius: 6, borderWidth: 1, borderColor: "#30363d",
            }}
          >
            <Text style={{ color: "#58a6ff", fontSize: 13, fontWeight: "600" }}>Load More</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
