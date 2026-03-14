import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../lib/api";

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  sealWalletAddress: string | null;
  walletId: number | null;
  walletProviderId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (data: {
    token: string;
    walletAddress: string;
    sealWalletAddress: string;
    walletId: number;
    walletProviderId?: string | null;
  }) => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

// Use SecureStore on native, AsyncStorage on web
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletAddress: null,
  sealWalletAddress: null,
  walletId: null,
  walletProviderId: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: async (data) => {
    api.setToken(data.token);
    await secureSet("sigil_token", data.token);
    await secureSet("sigil_wallet", data.walletAddress);
    await secureSet("sigil_seal_wallet", data.sealWalletAddress);
    await secureSet("sigil_wallet_id", data.walletId.toString());
    if (data.walletProviderId) await secureSet("sigil_wallet_provider_id", data.walletProviderId);
    else await secureDelete("sigil_wallet_provider_id");

    set({
      token: data.token,
      walletAddress: data.walletAddress,
      sealWalletAddress: data.sealWalletAddress,
      walletId: data.walletId,
      walletProviderId: data.walletProviderId ?? null,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  loadStoredAuth: async () => {
    try {
      const token = await secureGet("sigil_token");
      const walletAddress = await secureGet("sigil_wallet");
      const sealWalletAddress = await secureGet("sigil_seal_wallet");
      const walletIdStr = await secureGet("sigil_wallet_id");
      const walletProviderId = await secureGet("sigil_wallet_provider_id");

      if (token && walletAddress && sealWalletAddress && walletIdStr) {
        api.setToken(token);
        set({
          token,
          walletAddress,
          sealWalletAddress,
          walletId: parseInt(walletIdStr),
          walletProviderId,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    api.setToken(null);
    await secureDelete("sigil_token");
    await secureDelete("sigil_wallet");
    await secureDelete("sigil_seal_wallet");
    await secureDelete("sigil_wallet_id");
    await secureDelete("sigil_wallet_provider_id");

    set({
      token: null,
      walletAddress: null,
      sealWalletAddress: null,
      walletId: null,
      walletProviderId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },
}));
