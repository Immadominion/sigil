import "../global.css";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import "react-native-reanimated";
import { useAuthStore } from "../stores/auth";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

// Custom dark theme for Sigil
const SigilDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#0B0E17",
    card: "#141828",
    border: "#1E2640",
    primary: "#5B7FFF",
    text: "#F1F5F9",
    notification: "#EF4444",
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const loadStoredAuth = useAuthStore((s) => s.loadStoredAuth);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "onboarding";

    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/onboarding");
    } else if (isAuthenticated && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, segments]);

  // Don't render any screens until auth state is resolved
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B0E17", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#5B7FFF" />
      </View>
    );
  }

  return (
    <ThemeProvider value={SigilDarkTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen
          name="agent/[id]"
          options={{
            headerShown: true,
            headerTitle: "Agent Details",
            headerStyle: { backgroundColor: "#141828" },
            headerTintColor: "#F1F5F9",
            presentation: "card",
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
