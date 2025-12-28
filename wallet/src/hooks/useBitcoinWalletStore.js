/**
 * useBitcoinWalletStore.js
 *
 * A Zustand store implementing NIP-60 (Cashu Wallets) and NIP-61 (Nutzaps)
 * for Bitcoin Lightning payments via the Cashu ecash protocol.
 *
 * === PROTOCOL OVERVIEW ===
 *
 * Cashu is an ecash protocol that provides:
 * - Privacy: Transactions are unlinkable (the mint cannot track spending)
 * - Speed: Instant settlement without on-chain confirmations
 * - Low fees: Minimal transaction costs compared to on-chain Bitcoin
 *
 * === KEY CONCEPTS ===
 *
 * Proofs:
 *   Proofs are cryptographic tokens representing value. Each proof contains:
 *   - amount: The satoshi value of this proof
 *   - secret: A unique identifier that prevents double-spending
 *   - C: A blinded signature from the mint proving authenticity
 *   When you "spend" a proof, the mint marks the secret as used.
 *   Proofs are atomic - a 10 sat proof cannot be partially spent.
 *
 * Mints:
 *   Mints are trusted servers that issue and redeem proofs. They:
 *   - Accept Lightning payments and issue proofs in return
 *   - Verify proofs haven't been spent and allow transfers
 *   - Redeem proofs by paying Lightning invoices
 *   Users must trust their mint not to steal funds or go offline.
 *
 * NIP-60 (Cashu Wallet):
 *   Stores wallet state (proofs, mints) as encrypted Nostr events.
 *   Kind 37513: Wallet metadata and configuration
 *   Kind 7374/7375: Token and proof storage events
 *
 * NIP-61 (Nutzaps):
 *   Enables sending ecash via Nostr events:
 *   Kind 9321: Nutzap event containing proofs locked to recipient
 *   Kind 10019: User's payment preferences (mints, relays, pubkey)
 *
 * P2PK (Pay-to-Public-Key):
 *   Proofs can be locked to a specific public key, meaning only the
 *   holder of the corresponding private key can redeem them.
 *
 * === TRANSACTION FLOW ===
 *
 * Deposit (Lightning -> Ecash):
 *   1. Request invoice from mint for X sats
 *   2. Pay the Lightning invoice
 *   3. Mint issues proofs worth X sats
 *   4. Store proofs in wallet (published to Nostr relays)
 *
 * Send (Nutzap):
 *   1. Select proofs totaling the send amount
 *   2. "Split" proofs with mint: original proofs -> send proofs + change proofs
 *   3. Lock send proofs to recipient's public key (P2PK)
 *   4. Publish nutzap event (kind 9321) with locked proofs
 *   5. Store change proofs, mark original proofs as spent
 *
 * Receive:
 *   1. Find nutzap events addressed to our pubkey
 *   2. Claim proofs from the mint (swap for fresh proofs)
 *   3. Store new proofs in wallet
 */

import { create } from "zustand";
import NDK, { NDKPrivateKeySigner, NDKEvent } from "@nostr-dev-kit/ndk";
import { NDKCashuWallet } from "@nostr-dev-kit/ndk-wallet";
import { Buffer } from "buffer";
import { bech32 } from "bech32";

// Polyfill Buffer for browser environments (Node.js Buffer API)
if (typeof window !== "undefined") {
  window.Buffer = Buffer;
}

/**
 * Default Cashu mint URL
 * Minibits is a well-known, reliable mint for testing and small amounts.
 * In production, users should be able to choose their own trusted mints.
 */
const DEFAULT_MINT = "https://mint.minibits.cash/Bitcoin";

const DEFAULT_WALLET_ID = "Robots Building Education Wallet";
/**
 * Default Nostr relays for publishing and fetching wallet events.
 * Multiple relays provide redundancy and better message propagation.
 */
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

/**
 * Default payment recipient (used for testing/donations)
 * This is the npub of the Robots Building Education project.
 */
const DEFAULT_RECEIVER =
  "npub14vskcp90k6gwp6sxjs2jwwqpcmahg6wz3h5vzq0yn6crrsq0utts52axlt";

/**
 * Safely Extract Balance Value
 *
 * The wallet.balance property can return different types depending on
 * the wallet state and library version. This normalizes all formats
 * to a simple number.
 *
 * Possible input formats:
 * - null/undefined: Wallet not initialized -> 0
 * - number: Direct balance value -> return as-is
 * - { amount: number }: Object with amount property -> extract amount
 * - string: Stringified number -> parse to number
 *
 * @param {*} bal - The balance value in any format
 * @returns {number} The normalized balance in satoshis
 */
function extractBalance(bal) {
  if (bal === null || bal === undefined) return 0;
  if (typeof bal === "number") return bal;
  if (typeof bal === "object" && typeof bal.amount === "number") {
    return bal.amount;
  }
  const parsed = Number(bal);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Decode Bech32 Key to Hexadecimal
 *
 * Converts human-readable Nostr keys (npub/nsec) to raw hex format
 * required by cryptographic operations.
 *
 * Bech32 encoding provides:
 * - Human-readable prefix (npub/nsec) identifying key type
 * - Checksum for error detection
 * - Case-insensitive characters avoiding confusion (no 1/l, 0/O)
 *
 * @param {string} key - Bech32 encoded key (npub1... or nsec1...)
 * @returns {string|null} Hex encoded key or null on error
 */
function decodeKey(key) {
  try {
    const { words } = bech32.decode(key);
    return Buffer.from(bech32.fromWords(words)).toString("hex");
  } catch (e) {
    console.error("Error decoding key:", e);
    return null;
  }
}

/**
 * Verify Proof States with Mint
 *
 * Queries the mint to check which proofs are still spendable.
 * This is crucial because:
 *
 * 1. Proofs might be spent elsewhere (multi-device sync issues)
 * 2. Proofs might have been claimed by recipients
 * 3. Local state might be out of sync with mint
 *
 * Proof States (from Cashu NUT-07):
 * - UNSPENT: Proof is valid and can be spent
 * - SPENT: Proof has already been redeemed
 * - PENDING: Proof is in a pending transaction
 *
 * Why verify with mint?
 * The mint is the source of truth for proof validity. Local storage
 * might contain stale proofs that have been spent from another device
 * or session. Always verify before displaying balance or spending.
 *
 * @param {NDKCashuWallet} wallet - The wallet instance
 * @param {string} mintUrl - URL of the mint to verify against
 * @returns {number} Sum of unspent proof amounts in satoshis
 */
async function verifyBalanceWithMint(wallet, mintUrl) {
  try {
    const proofs = wallet.state?.getProofs({ mint: mintUrl }) || [];
    console.log("[Wallet] Proofs from state:", proofs.length);

    if (proofs.length === 0) {
      return 0;
    }

    const cashuWallet = await wallet.getCashuWallet(mintUrl);
    const proofStates = await cashuWallet.checkProofsStates(proofs);

    const unspentProofs = proofs.filter((proof, i) => {
      const state = proofStates[i];
      return state?.state === "UNSPENT";
    });

    const balance = unspentProofs.reduce((sum, p) => sum + p.amount, 0);
    console.log("[Wallet] Verified balance from mint:", balance);
    return balance;
  } catch (e) {
    console.error("[Wallet] Error verifying with mint:", e);
    return extractBalance(wallet.balance);
  }
}

export const useBitcoinWalletStore = create((set, get) => ({
  // ============================================================
  // STATE
  // ============================================================
  // Connection and identity state
  isConnected: false, // Whether connected to Nostr relays
  errorMessage: null, // Last error message for UI display
  nostrPubKey: "", // User's public key (npub format)
  nostrPrivKey: "", // User's private key (nsec format) - stored for session

  // NDK instances
  ndkInstance: null, // Active NDK connection to relays
  signer: null, // NDKPrivateKeySigner for signing events

  // Wallet state
  cashuWallet: null, // NDKCashuWallet instance
  walletBalance: 0, // Current balance in satoshis (verified with mint)
  proofs: [], // Local cache of proofs (source of truth is mint)
  invoice: "", // Current Lightning invoice for deposits
  isCreatingWallet: false, // Loading state during wallet creation
  isWalletReady: false, // Whether wallet is initialized and ready

  // ============================================================
  // BASIC SETTERS
  // ============================================================

  /**
   * Set error message for display in UI
   * @param {string} msg - Error message
   */
  setError: (msg) => set({ errorMessage: msg }),

  /**
   * Set the current Lightning invoice (for QR display)
   * @param {string} data - Lightning invoice (BOLT11 format)
   */
  setInvoice: (data) => set({ invoice: data }),

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Convert npub to hex format
   * Utility wrapper around decodeKey for convenience.
   *
   * @param {string} npub - Public key in bech32 format
   * @returns {string|null} Hex encoded public key
   */
  getHexNPub: (npub) => decodeKey(npub),

  /**
   * Verify Balance with Mint and Update State
   *
   * Fetches the current proof states from the mint and calculates
   * the true spendable balance. This should be called:
   * - After any transaction (send/receive)
   * - When the wallet is loaded
   * - Periodically to catch external changes
   *
   * @returns {number} The verified balance in satoshis
   */
  verifyAndUpdateBalance: async () => {
    const { cashuWallet } = get();
    if (!cashuWallet) return 0;

    const balance = await verifyBalanceWithMint(cashuWallet, DEFAULT_MINT);
    set({ walletBalance: balance });
    return balance;
  },

  // ============================================================
  // CONNECTION FUNCTIONS
  // ============================================================

  /**
   * Connect to Nostr Relay Network
   *
   * Establishes WebSocket connections to Nostr relays and initializes
   * the signer for authenticated operations.
   *
   * This is required before:
   * - Loading wallet data from relays
   * - Publishing transactions
   * - Fetching recipient payment info
   *
   * Key Resolution (falls back through each):
   * 1. Explicitly passed nsecRef parameter
   * 2. Stored nsec from localStorage
   * 3. nsec from current state
   *
   * @param {string|null} npubRef - Optional public key (currently unused)
   * @param {string|null} nsecRef - Optional private key to use
   * @returns {Object|null} { ndkInstance, signer } or null on failure
   */
  connectToNostr: async (npubRef = null, nsecRef = null) => {
    const { setError, nostrPrivKey } = get();

    const storedNsec = localStorage.getItem("local_nsec");
    const nsec = nsecRef || storedNsec || nostrPrivKey;

    try {
      const ndkInstance = new NDK({
        explicitRelayUrls: DEFAULT_RELAYS,
      });

      await ndkInstance.connect();

      // Handle private key mode
      if (!nsec || !nsec.startsWith("nsec")) {
        console.error("[Wallet] No valid nsec provided");
        return null;
      }

      const hexNsec = decodeKey(nsec);
      if (!hexNsec) throw new Error("Invalid nsec key");

      const signer = new NDKPrivateKeySigner(hexNsec);
      await signer.blockUntilReady();
      ndkInstance.signer = signer;
      const user = await signer.user();
      ndkInstance.activeUser = user;

      set({ isConnected: true, ndkInstance, signer });
      return { ndkInstance, signer };
    } catch (err) {
      console.error("[Wallet] Error connecting to Nostr:", err);
      setError(err.message);
      return null;
    }
  },

  // ============================================================
  // INITIALIZATION FUNCTIONS
  // ============================================================

  /**
   * Initialize Store from Persisted State
   *
   * Called on app startup to restore the user's session.
   * Attempts to reconnect to Nostr if credentials exist.
   *
   * Flow:
   * 1. Load keys from localStorage
   * 2. Update React state with loaded keys
   * 3. Attempt to connect to Nostr relays
   *
   * @returns {boolean} True if successfully connected, false otherwise
   */
  init: async () => {
    const storedNpub = localStorage.getItem("local_npub");
    const storedNsec = localStorage.getItem("local_nsec");

    if (storedNpub) set({ nostrPubKey: storedNpub });
    if (storedNsec) set({ nostrPrivKey: storedNsec });

    const { connectToNostr } = get();

    if (storedNpub && storedNsec) {
      const connection = await connectToNostr(storedNpub, storedNsec);
      return !!connection;
    }

    return false;
  },

  /**
   * Initialize Wallet (Load Existing Only)
   *
   * Attempts to load an existing wallet from Nostr relays.
   * Does NOT create a new wallet if none exists.
   *
   * NIP-60 Wallet Discovery:
   * Searches for wallet-related events published by the user:
   * - Kind 37513: Wallet metadata (replaceable event)
   * - Kind 7374: Token events (encrypted proofs)
   * - Kind 7375: Proof events (individual proof storage)
   *
   * If events are found, the wallet is reconstructed from relay data.
   * This enables multi-device sync - your wallet follows your keys.
   *
   * Event Listeners:
   * - "balance_updated": Fires when proofs change
   * - "ready": Fires when wallet is fully loaded
   * - "warning": Non-fatal issues (relay errors, etc.)
   *
   * @returns {NDKCashuWallet|null} The loaded wallet or null if not found
   */
  initWallet: async () => {
    const {
      ndkInstance,
      signer,
      cashuWallet,
      setError,
      verifyAndUpdateBalance,
    } = get();

    // Clean up existing wallet listeners to prevent memory leaks
    if (cashuWallet) {
      cashuWallet.removeAllListeners();
    }

    if (!ndkInstance || !signer) {
      console.error("[Wallet] NDK not ready");
      return null;
    }

    try {
      const user = await signer.user();
      console.log("[Wallet] Looking for wallet for pubkey:", user.pubkey);

      // Check for wallet events - try multiple possible kinds
      // These are NIP-60 defined event kinds for Cashu wallets
      const walletEvents = await ndkInstance.fetchEvents({
        kinds: [37513, 7374, 7375], // wallet, token, and proof kinds
        authors: [user.pubkey],
        limit: 5,
      });

      console.log("[Wallet] Found events:", walletEvents.size);
      walletEvents.forEach((e) => console.log("[Wallet] Event kind:", e.kind));

      if (walletEvents.size === 0) {
        console.log("[Wallet] No existing wallet found");
        return null;
      }

      console.log("[Wallet] Found existing wallet, loading...");

      const pk = signer.privateKey;
      const wallet = new NDKCashuWallet(ndkInstance);
      wallet.mints = [DEFAULT_MINT];
      wallet.walletId = DEFAULT_WALLET_ID;

      // Attach the private key for decrypting stored proofs
      // Proofs are encrypted before being stored on relays
      if (pk) {
        wallet.privkey = pk;
        wallet.signer = new NDKPrivateKeySigner(pk);
      }

      ndkInstance.wallet = wallet;

      // Start the wallet - this fetches and decrypts stored proofs
      await wallet.start({ pubkey: user.pubkey });

      console.log("[Wallet] Wallet status:", wallet.status);
      console.log("[Wallet] Wallet relaySet:", wallet.relaySet);

      // Listen for balance changes from the wallet
      wallet.on("balance_updated", (balance) => {
        console.log("[Wallet] >>> BALANCE EVENT FIRED:", balance);
        console.log("[Wallet] Balance updated event:", balance);
        if (balance?.amount !== undefined) {
          set({ walletBalance: balance.amount });
        } else {
          // Fallback to manual check
          verifyAndUpdateBalance();
        }
      });

      wallet.on("ready", () => {
        console.log("[Wallet] Wallet ready event");
        verifyAndUpdateBalance();
      });

      wallet.on("warning", (warning) => {
        console.warn("[Wallet] Warning:", warning.msg);
      });
      console.log("[Wallet] Wallet loaded, status:", wallet.status);

      set({ cashuWallet: wallet, isWalletReady: true });

      // Verify balance with mint (proofs might have been spent elsewhere)
      await verifyAndUpdateBalance();

      return wallet;
    } catch (err) {
      console.error("[Wallet] Error loading wallet:", err);
      setError(err.message);
      return null;
    }
  },

  // ============================================================
  // WALLET MANAGEMENT FUNCTIONS
  // ============================================================

  /**
   * Create and Publish New Wallet
   *
   * Creates a fresh NIP-60 wallet and publishes it to Nostr relays.
   * Should only be called when initWallet() returns null (no existing wallet).
   *
   * Wallet Creation Process:
   * 1. Create NDKCashuWallet instance
   * 2. Configure with user's private key and default mint
   * 3. Start the wallet (initializes internal state)
   * 4. Publish wallet metadata to relays (kind 37513)
   *
   * Publishing to relays enables:
   * - Multi-device access (wallet follows your keys)
   * - Backup (proofs stored encrypted on public relays)
   * - Recovery (can restore wallet with just the nsec)
   *
   * Note: Publishing might fail due to relay issues but the wallet
   * still works locally. Publishing is retried on subsequent operations.
   *
   * @returns {NDKCashuWallet|null} The created wallet or null on error
   */
  createNewWallet: async () => {
    const { ndkInstance, signer, setError, verifyAndUpdateBalance } = get();

    if (!ndkInstance || !signer) {
      console.error("[Wallet] NDK not ready");
      return null;
    }

    set({ isCreatingWallet: true });

    try {
      const pk = signer.privateKey;

      const wallet = new NDKCashuWallet(ndkInstance);
      wallet.mints = [DEFAULT_MINT];
      wallet.privkey = pk;
      wallet.signer = new NDKPrivateKeySigner(pk);
      wallet.walletId = DEFAULT_WALLET_ID;

      ndkInstance.wallet = wallet;

      const user = await signer.user();
      await wallet.start({ pubkey: user.pubkey });
      console.log("[Wallet] Wallet started");

      // Attempt to publish wallet to relays for multi-device sync
      // Non-critical: wallet works locally even if publish fails
      try {
        await wallet.publish();
        console.log("[Wallet] Wallet published to relays");
      } catch (pubErr) {
        console.warn("[Wallet] Could not publish (non-critical):", pubErr);
      }

      set({
        cashuWallet: wallet,
        isWalletReady: true,
        isCreatingWallet: false,
      });

      await verifyAndUpdateBalance();

      return wallet;
    } catch (err) {
      console.error("[Wallet] Error creating wallet:", err);
      setError(err.message);
      set({ isCreatingWallet: false });
      return null;
    }
  },

  /**
   * Fetch Recipient's Payment Preferences (NIP-61)
   *
   * Retrieves a user's preferred payment configuration from their
   * kind 10019 event (NIP-61 Nutzap Preferences).
   *
   * NIP-61 Kind 10019 Event Structure:
   * - "mint" tags: Mints the user accepts payments from
   * - "relay" tags: Relays to publish nutzaps to
   * - "pubkey" tag: Public key for P2PK locking (optional)
   *
   * Why this matters:
   * - Users may only trust certain mints
   * - P2PK locking ensures only the recipient can claim funds
   * - Publishing to recipient's relays ensures they see the payment
   *
   * Fallback Behavior:
   * If no preferences are found, uses:
   * - Default mint for ecash tokens
   * - Recipient's npub as P2PK pubkey
   * - Empty relay list (uses sender's default relays)
   *
   * @param {string} recipientNpub - Recipient's public key in bech32 format
   * @returns {Object} { mints, p2pkPubkey, relays }
   */
  fetchUserPaymentInfo: async (recipientNpub) => {
    const { ndkInstance } = get();

    if (!ndkInstance) {
      return { mints: [DEFAULT_MINT], p2pkPubkey: null, relays: [] };
    }

    const hexNpub = decodeKey(recipientNpub);
    if (!hexNpub) {
      return { mints: [DEFAULT_MINT], p2pkPubkey: null, relays: [] };
    }

    try {
      const filter = {
        kinds: [10019],
        authors: [hexNpub],
        limit: 1,
      };

      const events = await ndkInstance.fetchEvents(filter);
      const eventsArray = Array.from(events);

      if (eventsArray.length === 0) {
        return { mints: [DEFAULT_MINT], p2pkPubkey: hexNpub, relays: [] };
      }

      const userEvent = eventsArray[0];
      let mints = [];
      let relays = [];
      let p2pkPubkey = null;

      // Parse NIP-61 tags from the event
      for (const tag of userEvent.tags) {
        const [t, v1] = tag;
        if (t === "mint" && v1) mints.push(v1);
        else if (t === "relay" && v1) relays.push(v1);
        else if (t === "pubkey" && v1) p2pkPubkey = v1;
      }

      if (mints.length === 0) mints = [DEFAULT_MINT];
      if (!p2pkPubkey) p2pkPubkey = hexNpub;

      return { mints, p2pkPubkey, relays };
    } catch (e) {
      console.error("[Wallet] Error fetching payment info:", e);
      return { mints: [DEFAULT_MINT], p2pkPubkey: hexNpub, relays: [] };
    }
  },

  // ============================================================
  // TRANSACTION FUNCTIONS
  // ============================================================

  /**
   * Initiate a Deposit (Lightning -> Ecash)
   *
   * Creates a Lightning invoice that, when paid, mints new ecash proofs.
   * This is how users add funds to their Cashu wallet.
   *
   * Deposit Flow:
   * 1. Request invoice from mint for specified amount
   * 2. Return invoice for display (QR code / copy-paste)
   * 3. User pays invoice with any Lightning wallet
   * 4. Mint detects payment and issues proofs
   * 5. Proofs are saved to wallet state (and synced to relays)
   *
   * The deposit object is an event emitter:
   * - "success": Payment received, proofs minted
   * - "error": Payment failed or timed out
   *
   * Invoice Format (BOLT11):
   * Lightning invoices start with "lnbc" and contain:
   * - Amount in millisatoshis
   * - Payment hash (unique identifier)
   * - Expiry time
   * - Destination node
   *
   * @param {number} amountInSats - Amount to deposit in satoshis (default: 10)
   * @param {Object} options - Optional callbacks { onSuccess, onError }
   * @returns {string|null} BOLT11 invoice string or null on error
   */
  initiateDeposit: async (amountInSats = 10, options = {}) => {
    const { cashuWallet, setError, setInvoice, verifyAndUpdateBalance } = get();
    const { onSuccess, onError } = options;

    if (!cashuWallet) {
      setError("Wallet not initialized");
      return null;
    }

    try {
      const deposit = cashuWallet.deposit(amountInSats, DEFAULT_MINT);

      // Handle successful payment - proofs are minted
      deposit.on("success", async (token) => {
        console.log("[Wallet] Deposit successful!", token.proofs);

        // Save proofs to relay for backup and multi-device sync
        await cashuWallet.state.update({
          store: token.proofs,
          mint: DEFAULT_MINT,
        });

        // Verify balance with mint to get accurate count
        const newBalance = await verifyAndUpdateBalance();
        set({ invoice: "" });

        if (typeof onSuccess === "function") {
          onSuccess(newBalance);
        }
      });

      // Handle payment failure or timeout
      deposit.on("error", (e) => {
        console.error("[Wallet] Deposit error:", e);
        setError(e.message || "Deposit failed");
        setInvoice("");
        if (typeof onError === "function") {
          onError(e);
        }
      });

      // Start the deposit - returns the Lightning invoice
      const pr = await deposit.start();
      console.log("[Wallet] Invoice created");
      setInvoice(pr);
      return pr;
    } catch (e) {
      console.error("[Wallet] Error initiating deposit:", e);
      setError(e.message);
      return null;
    }
  },

  /**
   * Send 1 Satoshi via Nutzap (NIP-61)
   *
   * Sends ecash to another Nostr user by publishing a nutzap event.
   * Currently hardcoded to 1 sat for micro-tipping use case.
   *
   * === NUTZAP FLOW ===
   *
   * 1. PREPARATION:
   *    - Fetch recipient's payment preferences (kind 10019)
   *    - Refresh wallet state to get latest proofs
   *    - Verify proofs are unspent at the mint
   *
   * 2. PROOF SPLITTING:
   *    The cashuWallet.send() operation "splits" proofs:
   *    - Input: Your proofs (e.g., one 10-sat proof)
   *    - Output: "send" proofs (1 sat for recipient) + "keep" proofs (9 sat change)
   *
   *    The mint performs this atomically:
   *    - Marks original proofs as spent
   *    - Issues new proofs for send and keep amounts
   *    - P2PK locking applied to send proofs
   *
   * 3. P2PK LOCKING:
   *    Send proofs are locked to the recipient's public key.
   *    Only someone with the corresponding private key can redeem them.
   *    This prevents anyone else from claiming the funds.
   *
   * 4. NUTZAP PUBLICATION (Kind 9321):
   *    Event published to Nostr containing:
   *    - "proof" tags: JSON-serialized locked proofs
   *    - "amount" tag: Total amount being sent
   *    - "unit" tag: Currency unit (sat)
   *    - "u" tag: Mint URL where proofs are redeemable
   *    - "p" tag: Recipient's hex pubkey
   *
   * 5. STATE UPDATE:
   *    - Store change proofs (keep)
   *    - Destroy original proofs (prevent double-spend attempts)
   *    - Sync state to relays
   *
   * === ERROR HANDLING ===
   *
   * "Already spent" errors trigger automatic retry because:
   * - Proofs might have been spent from another device
   * - State might be stale from relay sync delays
   * - Refreshing wallet state often resolves the issue
   *
   * @param {string} recipientNpub - Recipient's public key (default: project donation address)
   * @param {number} retryCount - Internal retry counter (do not set manually)
   * @returns {boolean} True if send succeeded, false otherwise
   */
  send: async (recipientNpub = DEFAULT_RECEIVER, retryCount = 0) => {
    const {
      cashuWallet,
      ndkInstance,
      signer,
      fetchUserPaymentInfo,
      setError,
      walletBalance,
      verifyAndUpdateBalance,
      initWallet,
    } = get();

    const MAX_RETRIES = 2;

    if (!cashuWallet) {
      console.error("[Wallet] Wallet not initialized");
      return false;
    }

    if (walletBalance < 1) {
      console.error("[Wallet] Insufficient balance:", walletBalance);
      return false;
    }

    // Refresh wallet state to get latest proofs from relays
    await initWallet();

    const freshWallet = get().cashuWallet;

    if (!freshWallet) {
      console.error("[Wallet] Wallet not available after refresh");
      return false;
    }

    try {
      const amount = 1;
      const unit = "sat";

      // Get recipient's P2PK pubkey for locking proofs
      const { p2pkPubkey } = await fetchUserPaymentInfo(recipientNpub);
      console.log("[Wallet] Sending 1 sat to:", recipientNpub);

      const cashuWalletInstance = await freshWallet.getCashuWallet(
        DEFAULT_MINT
      );

      // Get proofs from wallet state
      let proofs = freshWallet.state?.getProofs({ mint: DEFAULT_MINT }) || [];
      if (proofs.length === 0) {
        throw new Error("No proofs available");
      }

      // CRITICAL: Verify proof states with mint before spending
      // Local state might be stale if proofs were spent elsewhere
      const proofStates = await cashuWalletInstance.checkProofsStates(proofs);

      // Filter to only unspent proofs
      const validProofs = proofs.filter((proof, index) => {
        const state = proofStates[index];
        return state?.state === "UNSPENT";
      });

      console.log("[Wallet] Total proofs:", proofs.length);
      console.log("[Wallet] Valid proofs:", validProofs.length);

      if (validProofs.length === 0) {
        throw new Error("No valid proofs available");
      }

      // Check if we have enough balance with valid proofs
      const validBalance = validProofs.reduce((sum, p) => sum + p.amount, 0);
      if (validBalance < amount) {
        throw new Error(`Insufficient valid balance: ${validBalance}`);
      }

      const recipientHex = decodeKey(recipientNpub);

      // Split proofs: creates send proofs (locked) and keep proofs (change)
      // P2PK locking is applied via the pubkey option
      const { keep, send } = await cashuWalletInstance.send(
        amount,
        validProofs,
        {
          pubkey: p2pkPubkey,
        }
      );

      console.log("[Wallet] Keep proofs:", keep);
      console.log("[Wallet] Send proofs:", send);

      // Update wallet state: store change, destroy originals
      // Destroying ALL proofs (not just valid) cleans up stale state
      await freshWallet.state.update({
        store: keep,
        destroy: proofs,
        mint: DEFAULT_MINT,
      });

      // Build nutzap event (kind 9321) with P2PK-locked proofs
      const proofTags = send.map((proof) => ["proof", JSON.stringify(proof)]);

      const nutzapEvent = new NDKEvent(ndkInstance, {
        kind: 9321,
        content: "Robots Building Education",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ...proofTags,
          ["amount", amount.toString()],
          ["unit", unit],
          ["u", DEFAULT_MINT],
          ["p", recipientHex],
        ],
      });

      // Sign and publish the nutzap to Nostr relays
      await nutzapEvent.sign(signer);
      await nutzapEvent.publish();
      console.log("[Wallet] Nutzap published!");

      // Update displayed balance
      await verifyAndUpdateBalance();

      return true;
    } catch (e) {
      console.error("[Wallet] Error sending nutzap:", e);

      // Retry on spent proof errors (likely stale state)
      const isSpentError =
        e.message?.toLowerCase().includes("already spent") ||
        e.message?.toLowerCase().includes("no valid proofs") ||
        e.message?.toLowerCase().includes("insufficient valid");

      if (isSpentError && retryCount < MAX_RETRIES) {
        console.log(
          `[Wallet] Retrying... attempt ${retryCount + 1}/${MAX_RETRIES}`
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        return get().send(recipientNpub, retryCount + 1);
      }

      setError(e.message);
      await verifyAndUpdateBalance();

      return false;
    }
  },

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  /**
   * Reset State (Logout)
   *
   * Clears all wallet and connection state, returning the store
   * to its initial state. Called when user logs out.
   *
   * What gets cleared:
   * - Connection state (isConnected, ndkInstance, signer)
   * - Identity (nostrPubKey, nostrPrivKey)
   * - Wallet (cashuWallet, walletBalance, proofs)
   * - UI state (invoice, isCreatingWallet, isWalletReady)
   *
   * Note: This does NOT clear localStorage - use the identity
   * hook's logout() for full session clearing. This only resets
   * the in-memory Zustand state.
   *
   * The wallet and proofs still exist on relays and can be
   * recovered by logging in again with the same nsec.
   */
  resetState: () => {
    set({
      isConnected: false,
      errorMessage: null,
      nostrPubKey: "",
      nostrPrivKey: "",
      ndkInstance: null,
      signer: null,
      cashuWallet: null,
      walletBalance: 0,
      proofs: [],
      invoice: "",
      isCreatingWallet: false,
      isWalletReady: false,
    });
  },
}));

export default useBitcoinWalletStore;
