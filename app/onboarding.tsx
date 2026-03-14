import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Image,
} from "react-native";
import { Buffer } from "buffer";
import * as Linking from "expo-linking";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { buildCreateWalletInstruction, deriveWalletPda } from "../lib/seal";
import { APP_NAME, SOLANA_CLUSTER, SOLANA_RPC_URL } from "../lib/constants";
import { getInjectedWebWalletProvider, getWebWalletProviderId } from "../lib/web-wallet";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Step = "welcome" | "connect" | "initialize";

interface ConnectedWallet {
  token: string;
  walletAddress: string;
  sealWalletAddress: string;
  walletId: number;
  walletProviderId?: string | null;
  sendTx: (tx: Transaction) => Promise<string>;
}

interface DetectedWallet {
  name: string;
  icon?: string;
  connect: () => Promise<ConnectedWallet>;
}

// ─────────────────────────────────────────────────────────────
// Feature bullets
// ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "🔐",
    title: "Scoped Agent Sessions",
    desc: "Grant AI bots limited, time-bound on-chain authority",
  },
  {
    icon: "📱",
    title: "Mobile Control Plane",
    desc: "Approve, monitor, and revoke from anywhere",
  },
  {
    icon: "🌐",
    title: "Universal Pairing",
    desc: "One token connects any agent across any platform",
  },
];

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function Onboarding() {
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<Step>("welcome");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);

  // Pending auth — stored between connect and initialize steps
  const pendingRef = useRef<ConnectedWallet | null>(null);

  // Initialize step
  const [depositSol, setDepositSol] = useState("0.1");
  const [initializing, setInitializing] = useState(false);
  const [airdropping, setAirdropping] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  // iOS deeplink refs
  const dappKeyPairRef = useRef<nacl.BoxKeyPair | null>(null);
  const sharedSecretRef = useRef<Uint8Array | null>(null);
  const pendingNonceRef = useRef<string | null>(null);
  const pendingWalletRef = useRef<string | null>(null);
  const phantomSessionRef = useRef<string | null>(null);

  // ── iOS deeplink listener ──
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const onUrl = async ({ url }: { url: string }) => {
      try {
        const parsed = new URL(url);
        const params = parsed.searchParams;

        if (params.get("errorCode")) {
          showError(params.get("errorMessage") ?? "Wallet rejected the request");
          setConnecting(false);
          setInitializing(false);
          return;
        }

        // ── Step 1: Connected ──
        if (/onConnect/.test(parsed.pathname + parsed.host)) {
          const phantomPub = params.get("phantom_encryption_public_key");
          const nonce = params.get("nonce");
          const data = params.get("data");
          if (!phantomPub || !nonce || !data || !dappKeyPairRef.current) return;

          const sharedSecret = nacl.box.before(
            bs58.decode(phantomPub),
            dappKeyPairRef.current.secretKey,
          );
          sharedSecretRef.current = sharedSecret;

          const decrypted = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecret,
          );
          if (!decrypted) throw new Error("Failed to decrypt Phantom response");
          const payload = JSON.parse(Buffer.from(decrypted).toString("utf8"));
          const walletAddress: string = payload.public_key;
          const session: string = payload.session;
          phantomSessionRef.current = session;

          const { nonce: backendNonce } = await api.getNonce(walletAddress);
          pendingNonceRef.current = backendNonce;
          pendingWalletRef.current = walletAddress;

          const message = buildSIWSMessage(walletAddress, backendNonce);
          const [encNonce, encPayload] = encryptPayload(
            { session, message: bs58.encode(Buffer.from(message)) },
            sharedSecret,
          );
          const signParams = new URLSearchParams({
            dapp_encryption_public_key: bs58.encode(dappKeyPairRef.current!.publicKey),
            nonce: bs58.encode(encNonce),
            redirect_link: Linking.createURL("onSignMessage"),
            payload: bs58.encode(encPayload),
          });
          await Linking.openURL(buildPhantomUrl("signMessage", signParams));

          // ── Step 2: Signed ──
        } else if (/onSignMessage/.test(parsed.pathname + parsed.host)) {
          const nonce = params.get("nonce");
          const data = params.get("data");
          if (!nonce || !data || !sharedSecretRef.current) return;

          const decrypted = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecretRef.current,
          );
          if (!decrypted) throw new Error("Failed to decrypt signature");
          const payload = JSON.parse(Buffer.from(decrypted).toString("utf8"));
          const signatureBase64 = Buffer.from(bs58.decode(payload.signature)).toString("base64");

          const walletAddress = pendingWalletRef.current!;
          const backendNonce = pendingNonceRef.current!;
          const message = buildSIWSMessage(walletAddress, backendNonce);
          const result = await api.verify({ walletAddress, nonce: backendNonce, signature: signatureBase64, message });

          // Build iOS sendTx that uses Phantom deeplink signAndSendTransaction
          const iosSendTx = async (tx: Transaction): Promise<string> => {
            return new Promise<string>((resolve, reject) => {
              if (!dappKeyPairRef.current || !sharedSecretRef.current || !phantomSessionRef.current) {
                reject(new Error("Lost Phantom session. Please reconnect."));
                return;
              }
              const serialized = tx.serialize({ requireAllSignatures: false });
              const [encNonce2, encPayload2] = encryptPayload(
                { session: phantomSessionRef.current, transaction: bs58.encode(serialized) },
                sharedSecretRef.current!,
              );
              const txParams = new URLSearchParams({
                dapp_encryption_public_key: bs58.encode(dappKeyPairRef.current!.publicKey),
                nonce: bs58.encode(encNonce2),
                redirect_link: Linking.createURL("onSignAndSendTransaction"),
                payload: bs58.encode(encPayload2),
              });
              // Store resolve/reject for the deeplink callback
              (globalThis as any).__phantomSendTxResolve = resolve;
              (globalThis as any).__phantomSendTxReject = reject;
              Linking.openURL(buildPhantomUrl("signAndSendTransaction", txParams)).catch(reject);
            });
          };

          const connected: ConnectedWallet = {
            token: result.token,
            walletAddress: result.wallet.ownerAddress,
            sealWalletAddress: result.wallet.sealWalletAddress,
            walletId: result.wallet.id,
            walletProviderId: null,
            sendTx: iosSendTx,
          };
          await handlePostConnect(connected);
          setConnecting(false);

          // ── Step 3 (iOS): Transaction sent ──
        } else if (/onSignAndSendTransaction/.test(parsed.pathname + parsed.host)) {
          const nonce = params.get("nonce");
          const data = params.get("data");
          if (!nonce || !data || !sharedSecretRef.current) return;

          const decrypted = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecretRef.current,
          );
          if (!decrypted) throw new Error("Failed to decrypt transaction result");
          const payload = JSON.parse(Buffer.from(decrypted).toString("utf8"));

          const resolve: ((sig: string) => void) | undefined = (globalThis as any).__phantomSendTxResolve;
          if (resolve) {
            resolve(payload.signature as string);
            delete (globalThis as any).__phantomSendTxResolve;
            delete (globalThis as any).__phantomSendTxReject;
          }
        }
      } catch (err: any) {
        showError(err.message ?? "Connection failed");
        setConnecting(false);
        setInitializing(false);
        const reject: ((err: Error) => void) | undefined = (globalThis as any).__phantomSendTxReject;
        if (reject) {
          reject(err);
          delete (globalThis as any).__phantomSendTxResolve;
          delete (globalThis as any).__phantomSendTxReject;
        }
      }
    };

    const sub = Linking.addEventListener("url", onUrl);
    return () => sub.remove();
  }, []);

  // ── Web: detect installed wallets on mount ──
  useEffect(() => {
    if (Platform.OS !== "web") return;
    detectWebWallets().then(setWallets).catch(() => { });
  }, []);

  const showError = (msg: string) => {
    setError(msg);
    if (Platform.OS !== "web") Alert.alert("Connection Failed", msg);
  };

  // After connecting: check if wallet is on-chain; route to init or dashboard
  const handlePostConnect = async (connected: ConnectedWallet) => {
    api.setToken(connected.token);
    const walletInfo = await api.getWallet().catch(() => null);
    if (walletInfo?.onChain) {
      await setAuth(connected);
    } else {
      pendingRef.current = connected;
      setStep("initialize");
    }
  };

  // Web: connect a detected wallet
  const handleConnectWebWallet = useCallback(async (wallet: DetectedWallet) => {
    setConnecting(true);
    setError(null);
    try {
      const connected = await wallet.connect();
      await handlePostConnect(connected);
    } catch (err: any) {
      showError(err.message ?? "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  // iOS: Phantom deeplink connect
  const handleConnectIOS = useCallback(() => {
    setConnecting(true);
    setError(null);
    dappKeyPairRef.current = nacl.box.keyPair();
    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPairRef.current.publicKey),
      cluster: SOLANA_CLUSTER,
      app_url: "https://sigil.app",
      redirect_link: Linking.createURL("onConnect"),
    });
    Linking.openURL(buildPhantomUrl("connect", params)).catch((err) => {
      showError(err.message ?? "Could not open Phantom. Is it installed?");
      setConnecting(false);
    });
  }, []);

  // Android: MWA transact
  const handleConnectAndroid = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { transact } = await import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
      await transact(async (wallet: any) => {
        const authResult = await wallet.authorize({
          identity: { name: "Sigil", uri: "https://sigil.app", icon: "favicon.png" },
          cluster: SOLANA_CLUSTER,
        });
        const publicKeyBytes: Uint8Array = authResult.accounts[0].address;
        const walletAddress = bs58.encode(publicKeyBytes);

        const { nonce } = await api.getNonce(walletAddress);
        const message = buildSIWSMessage(walletAddress, nonce);
        const signResult = await wallet.signMessages({
          addresses: [publicKeyBytes],
          payloads: [new TextEncoder().encode(message)],
        });
        const signatureBase64 = Buffer.from(signResult[0]).toString("base64");
        const result = await api.verify({ walletAddress, nonce, signature: signatureBase64, message });

        const androidSendTx = async (tx: Transaction): Promise<string> => {
          return transact(async (w: any) => {
            await w.authorize({
              identity: { name: "Sigil", uri: "https://sigil.app", icon: "favicon.png" },
              cluster: SOLANA_CLUSTER,
            });
            const sigs = await w.signAndSendTransactions({
              transactions: [tx.serialize({ requireAllSignatures: false })],
            });
            return sigs[0] as string;
          });
        };

        const connected: ConnectedWallet = {
          token: result.token,
          walletAddress: result.wallet.ownerAddress,
          sealWalletAddress: result.wallet.sealWalletAddress,
          walletId: result.wallet.id,
          walletProviderId: null,
          sendTx: androidSendTx,
        };
        await handlePostConnect(connected);
      });
    } catch (err: any) {
      showError(err.message ?? "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  // Fetch wallet SOL balance on devnet
  const refreshBalance = useCallback(async () => {
    const connected = pendingRef.current;
    if (!connected) return;
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const balance = await connection.getBalance(new PublicKey(connected.walletAddress));
      setWalletBalance(balance / LAMPORTS_PER_SOL);
    } catch {
      // ignore
    }
  }, []);

  // Auto-refresh balance when reaching initialize step
  useEffect(() => {
    if (step === "initialize") refreshBalance();
  }, [step, refreshBalance]);

  // Devnet airdrop
  const handleAirdrop = async () => {
    const connected = pendingRef.current;
    if (!connected || SOLANA_CLUSTER !== "devnet") return;
    setAirdropping(true);
    setError(null);
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const sig = await connection.requestAirdrop(
        new PublicKey(connected.walletAddress),
        2 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
      await refreshBalance();
    } catch (err: any) {
      showError(err.message?.includes("429")
        ? "Devnet airdrop rate-limited. Try again in a minute, or use solfaucet.com."
        : err.message ?? "Airdrop failed");
    } finally {
      setAirdropping(false);
    }
  };

  // Initialize: build + send create wallet tx (+ optional deposit)
  const handleInitialize = async (skipDeposit = false) => {
    const connected = pendingRef.current;
    if (!connected) return;
    setInitializing(true);
    setError(null);
    try {
      const deposit = skipDeposit ? 0 : Math.max(0, parseFloat(depositSol) || 0);
      const ownerPubkey = new PublicKey(connected.walletAddress);
      const [walletPda] = deriveWalletPda(ownerPubkey);

      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const { blockhash } = await connection.getLatestBlockhash();

      const tx = new Transaction();
      tx.add(buildCreateWalletInstruction(ownerPubkey));
      if (deposit > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: ownerPubkey,
            toPubkey: walletPda,
            lamports: Math.round(deposit * LAMPORTS_PER_SOL),
          })
        );
      }
      tx.feePayer = ownerPubkey;
      tx.recentBlockhash = blockhash;

      await connected.sendTx(tx);

      // Poll for on-chain confirmation (up to 20s)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const info = await api.getWallet().catch(() => null);
        if (info?.onChain) break;
      }

      await setAuth(connected);
    } catch (err: any) {
      showError(err.message ?? "Failed to create wallet");
    } finally {
      setInitializing(false);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // RENDER — WELCOME
  // ══════════════════════════════════════════════════════════════
  if (step === "welcome") {
    return (
      <View style={{ flex: 1, backgroundColor: "#0d1117" }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={{
            flex: 1, alignItems: "center", justifyContent: "center",
            paddingHorizontal: 32, paddingTop: 80, paddingBottom: 24,
          }}>
            {/* Logo mark */}
            <View style={{
              width: 96, height: 96, borderRadius: 28,
              backgroundColor: "rgba(88,166,255,0.1)",
              borderWidth: 1, borderColor: "rgba(88,166,255,0.25)",
              alignItems: "center", justifyContent: "center", marginBottom: 28,
            }}>
              <Text style={{ fontSize: 52, lineHeight: 60 }}>⬡</Text>
            </View>

            <Text style={{ fontSize: 38, fontWeight: "800", color: "#fff", letterSpacing: -1, marginBottom: 10 }}>
              {APP_NAME}
            </Text>
            <Text style={{ fontSize: 16, color: "#8b949e", textAlign: "center", marginBottom: 52, lineHeight: 24 }}>
              The smart wallet for{"\n"}autonomous AI agents
            </Text>

            {/* Feature list */}
            <View style={{ width: "100%", maxWidth: 360 }}>
              {FEATURES.map((f, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row", alignItems: "flex-start", gap: 14,
                    marginBottom: i < FEATURES.length - 1 ? 22 : 0,
                  }}
                >
                  <View style={{
                    width: 40, height: 40, borderRadius: 6,
                    backgroundColor: "rgba(88,166,255,0.1)",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <Text style={{ fontSize: 18 }}>{f.icon}</Text>
                  </View>
                  <View style={{ flex: 1, paddingTop: 2 }}>
                    <Text style={{ color: "#e6edf3", fontWeight: "600", fontSize: 14, marginBottom: 3 }}>
                      {f.title}
                    </Text>
                    <Text style={{ color: "#8b949e", fontSize: 12, lineHeight: 18 }}>{f.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Sticky CTA */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12 }}>
          <Pressable
            onPress={() => { setError(null); setStep("connect"); }}
            style={{ backgroundColor: "#58a6ff", borderRadius: 6, paddingVertical: 16, alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 17 }}>Get Started</Text>
          </Pressable>
          <Text style={{ color: "#484f58", fontSize: 11, textAlign: "center", marginTop: 12 }}>
            Solana {SOLANA_CLUSTER} · Non-custodial
          </Text>
        </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — CONNECT
  // ══════════════════════════════════════════════════════════════
  if (step === "connect") {
    return (
      <View style={{ flex: 1, backgroundColor: "#0d1117" }}>
        {/* Header */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          paddingHorizontal: 24, paddingTop: 64, paddingBottom: 8, gap: 12,
        }}>
          <Pressable
            onPress={() => { setStep("welcome"); setError(null); setConnecting(false); }}
            style={{ padding: 8 }}
          >
            <Text style={{ color: "#8b949e", fontSize: 22, lineHeight: 28 }}>←</Text>
          </Pressable>
          <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>Connect Wallet</Text>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16 }}>
          {Platform.OS === "web" ? (
            <View>
              {wallets.length === 0 ? (
                <View style={{ paddingVertical: 48, alignItems: "center" }}>
                  <Text style={{ fontSize: 52, marginBottom: 16 }}>👻</Text>
                  <Text style={{ color: "#e6edf3", fontSize: 16, fontWeight: "600", marginBottom: 8, textAlign: "center" }}>
                    No wallets detected
                  </Text>
                  <Text style={{ color: "#8b949e", fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 24 }}>
                    Install a Solana wallet extension{"\n"}like Phantom to continue.
                  </Text>
                  <Pressable
                    onPress={() => (window as any).open("https://phantom.app", "_blank")}
                    style={{ paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6, borderWidth: 1, borderColor: "#58a6ff" }}
                  >
                    <Text style={{ color: "#58a6ff", fontWeight: "600" }}>Get Phantom →</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <Text style={{ color: "#6e7681", fontSize: 12, marginBottom: 6 }}>
                    {wallets.length} wallet{wallets.length > 1 ? "s" : ""} available
                  </Text>
                  {wallets.map((w) => (
                    <Pressable
                      key={w.name}
                      onPress={() => !connecting && handleConnectWebWallet(w)}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 14,
                        padding: 16, backgroundColor: "#161b22", borderRadius: 6,
                        borderWidth: 1, borderColor: "#30363d",
                        opacity: connecting ? 0.6 : 1,
                      }}
                    >
                      {w.icon ? (
                        <Image source={{ uri: w.icon }} style={{ width: 48, height: 48, borderRadius: 6 }} />
                      ) : (
                        <View style={{
                          width: 48, height: 48, borderRadius: 6,
                          backgroundColor: "#30363d", alignItems: "center", justifyContent: "center",
                        }}>
                          <Text style={{ color: "#8b949e", fontWeight: "700", fontSize: 14 }}>
                            {w.name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>{w.name}</Text>
                        <Text style={{ color: "#8b949e", fontSize: 12, marginTop: 2 }}>Tap to connect</Text>
                      </View>
                      {connecting ? (
                        <ActivityIndicator size="small" color="#58a6ff" />
                      ) : (
                        <Text style={{ color: "#6e7681", fontSize: 20, lineHeight: 24 }}>›</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : Platform.OS === "ios" ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: "#8b949e", fontSize: 13, lineHeight: 20, marginBottom: 8 }}>
                Connect securely via Phantom. You'll be redirected to approve.
              </Text>
              <Pressable
                onPress={handleConnectIOS}
                disabled={connecting}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 14, padding: 16,
                  backgroundColor: "#161b22", borderRadius: 6,
                  borderWidth: 1, borderColor: "#30363d",
                  opacity: connecting ? 0.6 : 1,
                }}
              >
                <View style={{
                  width: 48, height: 48, borderRadius: 6,
                  backgroundColor: "#AB9FF2", alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 24 }}>👻</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Phantom</Text>
                  <Text style={{ color: "#8b949e", fontSize: 12, marginTop: 2 }}>Opens Phantom app</Text>
                </View>
                {connecting ? (
                  <ActivityIndicator size="small" color="#58a6ff" />
                ) : (
                  <Text style={{ color: "#6e7681", fontSize: 20, lineHeight: 24 }}>›</Text>
                )}
              </Pressable>
            </View>
          ) : (
            // Android
            <View style={{ gap: 12 }}>
              <Text style={{ color: "#8b949e", fontSize: 13, marginBottom: 8 }}>
                Connect via Mobile Wallet Adapter (Phantom, Solflare, etc.)
              </Text>
              <Pressable
                onPress={handleConnectAndroid}
                disabled={connecting}
                style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
                  padding: 16, backgroundColor: "#58a6ff", borderRadius: 6,
                  opacity: connecting ? 0.6 : 1,
                }}
              >
                {connecting && <ActivityIndicator size="small" color="#fff" />}
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </Text>
              </Pressable>
            </View>
          )}

          {error && (
            <View style={{
              marginTop: 16, padding: 14, borderRadius: 6,
              backgroundColor: "rgba(248,81,73,0.08)",
              borderWidth: 1, borderColor: "rgba(248,81,73,0.25)",
            }}>
              <Text style={{ color: "#F87171", fontSize: 13, lineHeight: 20 }}>{error}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — INITIALIZE
  // ══════════════════════════════════════════════════════════════
  const connected = pendingRef.current;
  const depositAmount = Math.max(0, parseFloat(depositSol) || 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0d1117" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48 }}>
          {/* Success badge */}
          <View style={{ alignItems: "center", marginBottom: 36 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: "rgba(63,185,80,0.12)",
              borderWidth: 1, borderColor: "rgba(63,185,80,0.3)",
              alignItems: "center", justifyContent: "center", marginBottom: 16,
            }}>
              <Text style={{ fontSize: 26 }}>✓</Text>
            </View>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 6 }}>
              Wallet Connected
            </Text>
            {connected && (
              <Text style={{ color: "#6e7681", fontSize: 13, fontFamily: "SpaceMono" }}>
                {connected.walletAddress.slice(0, 6)}...{connected.walletAddress.slice(-4)}
              </Text>
            )}
            {walletBalance !== null && (
              <Text style={{ color: "#8b949e", fontSize: 12, marginTop: 4 }}>
                Balance: {walletBalance.toFixed(4)} SOL
              </Text>
            )}
          </View>

          {/* Devnet airdrop (only visible on devnet) */}
          {SOLANA_CLUSTER === "devnet" && (
            <View style={{
              backgroundColor: "rgba(210,153,34,0.08)", borderRadius: 6,
              borderWidth: 1, borderColor: "rgba(210,153,34,0.25)",
              padding: 16, marginBottom: 16,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#d29922", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Devnet Mode
                  </Text>
                  <Text style={{ color: "#8b949e", fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                    {walletBalance !== null && walletBalance < 0.01
                      ? "Your wallet needs SOL to create the on-chain account."
                      : "Request free test SOL if you need more."}
                  </Text>
                </View>
                <Pressable
                  onPress={handleAirdrop}
                  disabled={airdropping}
                  style={{
                    backgroundColor: airdropping ? "rgba(210,153,34,0.15)" : "rgba(210,153,34,0.2)",
                    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, marginLeft: 12,
                  }}
                >
                  {airdropping ? (
                    <ActivityIndicator size="small" color="#d29922" />
                  ) : (
                    <Text style={{ color: "#d29922", fontWeight: "700", fontSize: 13 }}>
                      Airdrop 2 SOL
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Initialize card */}
          <View style={{
            backgroundColor: "#161b22", borderRadius: 6,
            borderWidth: 1, borderColor: "#30363d",
            padding: 22, marginBottom: 16,
          }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 6 }}>
              Create Seal Wallet
            </Text>
            <Text style={{ color: "#8b949e", fontSize: 13, lineHeight: 20, marginBottom: 24 }}>
              Your on-chain smart account that enforces agent permissions, spending limits, and time-bounds.
            </Text>

            <Text style={{ color: "#484f58", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Initial Deposit (optional)
            </Text>

            {/* Amount input */}
            <View style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: "#0d1117",
              borderRadius: 6, borderWidth: 1, borderColor: "#30363d", marginBottom: 6,
            }}>
              <TextInput
                value={depositSol}
                onChangeText={setDepositSol}
                keyboardType="decimal-pad"
                placeholder="0.1"
                placeholderTextColor="#30363d"
                style={{ flex: 1, color: "#fff", paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, fontWeight: "600" }}
              />
              <Text style={{ color: "#6e7681", paddingRight: 16, fontWeight: "600", fontSize: 14 }}>SOL</Text>
            </View>
            <Text style={{ color: "#484f58", fontSize: 11, marginBottom: 18 }}>
              + ~0.001 SOL network fee
            </Text>

            {/* Quick amount pills */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {["0.1", "0.5", "1.0", "5.0"].map((amt) => {
                const active = depositSol === amt;
                return (
                  <Pressable
                    key={amt}
                    onPress={() => setDepositSol(amt)}
                    style={{
                      flex: 1, paddingVertical: 9, borderRadius: 6, alignItems: "center",
                      borderWidth: 1,
                      borderColor: active ? "#58a6ff" : "#30363d",
                      backgroundColor: active ? "rgba(88,166,255,0.1)" : "transparent",
                    }}
                  >
                    <Text style={{ color: active ? "#58a6ff" : "#6e7681", fontSize: 12, fontWeight: "600" }}>
                      {amt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Primary CTA */}
          <Pressable
            onPress={() => handleInitialize(false)}
            disabled={initializing}
            style={{
              borderRadius: 6, paddingVertical: 16, alignItems: "center", marginBottom: 12,
              backgroundColor: initializing ? "rgba(88,166,255,0.4)" : "#58a6ff",
            }}
          >
            {initializing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Creating Wallet...</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                {depositAmount > 0
                  ? `Create Wallet + Deposit ${depositAmount} SOL`
                  : "Create Wallet"}
              </Text>
            )}
          </Pressable>

          {/* Skip deposit */}
          <Pressable
            onPress={() => handleInitialize(true)}
            disabled={initializing}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={{ color: "#6e7681", fontSize: 13 }}>
              Skip deposit, create wallet only
            </Text>
          </Pressable>

          {error && (
            <View style={{
              marginTop: 16, padding: 14, borderRadius: 6,
              backgroundColor: "rgba(248,81,73,0.08)",
              borderWidth: 1, borderColor: "rgba(248,81,73,0.25)",
            }}>
              <Text style={{ color: "#F87171", fontSize: 13, lineHeight: 20 }}>{error}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function buildSIWSMessage(walletAddress: string, nonce: string): string {
  return [
    "Sigil wants you to sign in with your Solana account:",
    walletAddress,
    "",
    "Sign in to manage your Seal smart wallet agents.",
    "",
    `Nonce: ${nonce}`,
  ].join("\n");
}

function buildPhantomUrl(path: string, params: URLSearchParams): string {
  return `https://phantom.app/ul/v1/${path}?${params.toString()}`;
}

function encryptPayload(payload: object, sharedSecret: Uint8Array): [Uint8Array, Uint8Array] {
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box.after(
    Buffer.from(JSON.stringify(payload)),
    nonce,
    sharedSecret,
  );
  return [nonce, encrypted];
}

/**
 * Discover Solana wallets via Wallet Standard, with legacy fallback.
 */
async function detectWebWallets(): Promise<DetectedWallet[]> {
  if (typeof window === "undefined") return [];
  const detected: DetectedWallet[] = [];

  // ── Wallet Standard: used ONLY for wallet discovery (name + icon) ──
  // We intentionally do NOT use solana:signMessage from Wallet Standard because
  // it requires a separate authorization step that standard:connect doesn't grant,
  // causing "The requested method and/or account has not been authorized" errors.
  // Instead we connect via WS then fall through to the legacy window provider for signing.
  try {
    const { getWallets } = await import("@wallet-standard/app");
    const { get: getRegisteredWallets } = getWallets();

    const seenNames = new Set<string>();
    for (const wallet of getRegisteredWallets()) {
      const connectFeature = (wallet.features as Record<string, unknown>)["standard:connect"];
      if (!connectFeature) continue;
      // Deduplicate: some wallets register multiple Wallet Standard entries
      const normName = wallet.name.toLowerCase();
      if (seenNames.has(normName)) continue;
      seenNames.add(normName);

      const connectFn = connectFeature as {
        connect: (opts?: { silent?: boolean }) => Promise<{ accounts: any[] }>;
      };

      detected.push({
        name: wallet.name,
        icon: wallet.icon,
        connect: async () => {
          // Step 1: Authorize via Wallet Standard (gets the account into the wallet's authorized set)
          await connectFn.connect();

          // Step 2: Use the legacy window provider for signMessage + sendTx.
          // This always works post-connect and avoids the WS "not authorized" issue.
          const provider = getLegacyProvider(wallet.name);
          if (!provider) throw new Error(`Could not find ${wallet.name} provider. Try reloading the page.`);

          const walletAddress: string = provider.publicKey?.toBase58();
          if (!walletAddress) throw new Error("Failed to get public key from wallet");

          const { nonce } = await api.getNonce(walletAddress);
          const message = buildSIWSMessage(walletAddress, nonce);
          const encoded = new TextEncoder().encode(message);

          const { signature: msgSig } = await provider.signMessage(encoded);
          const signatureBase64 = Buffer.from(msgSig).toString("base64");

          const result = await api.verify({ walletAddress, nonce, signature: signatureBase64, message });

          const sendTx = async (tx: Transaction): Promise<string> => {
            const { signature } = await provider.signAndSendTransaction(tx);
            return typeof signature === "string" ? signature : bs58.encode(signature);
          };

          return {
            token: result.token,
            walletAddress: result.wallet.ownerAddress,
            sealWalletAddress: result.wallet.sealWalletAddress,
            walletId: result.wallet.id,
            walletProviderId: getWebWalletProviderId(wallet.name),
            sendTx,
          };
        },
      });
    }
  } catch (_e) {
    // Wallet Standard unavailable — fall through to legacy providers
  }

  // ── Legacy fallback: window.phantom / window.solflare / window.solana ──
  const legacyProviders: Array<{ name: string; getProvider: () => any }> = [
    { name: "Phantom", getProvider: () => (window as any).phantom?.solana },
    { name: "Solflare", getProvider: () => (window as any).solflare },
    { name: "Solana Wallet", getProvider: () => (window as any).solana },
  ];

  for (const { name, getProvider } of legacyProviders) {
    const provider = getProvider();
    if (!provider?.connect) continue;
    const alreadyFound = detected.some(
      (d) => d.name.toLowerCase().includes(name.split(" ")[0].toLowerCase())
    );
    if (alreadyFound) continue;

    detected.push({
      name,
      connect: async () => {
        await provider.connect();
        const walletAddress: string = provider.publicKey?.toBase58();
        if (!walletAddress) throw new Error("Failed to get public key");

        const { nonce } = await api.getNonce(walletAddress);
        const message = buildSIWSMessage(walletAddress, nonce);
        const encoded = new TextEncoder().encode(message);

        const { signature: msgSig } = await provider.signMessage(encoded);
        const signatureBase64 = Buffer.from(msgSig).toString("base64");

        const result = await api.verify({ walletAddress, nonce, signature: signatureBase64, message });

        const sendTx = async (tx: Transaction): Promise<string> => {
          const { signature } = await provider.signAndSendTransaction(tx);
          return typeof signature === "string" ? signature : bs58.encode(signature);
        };

        return {
          token: result.token,
          walletAddress: result.wallet.ownerAddress,
          sealWalletAddress: result.wallet.sealWalletAddress,
          walletId: result.wallet.id,
          walletProviderId: getWebWalletProviderId(name),
          sendTx,
        };
      },
    });
  }

  return detected;
}

/** 
 * Returns the legacy injected-provider object for the given wallet name.
 * Wallet Standard's solana:signMessage requires a separate authorization step
 * that standard:connect does NOT grant. Using the legacy provider avoids this.
 */
function getLegacyProvider(walletName: string): any {
  return getInjectedWebWalletProvider(getWebWalletProviderId(walletName));
}
