/**
 * useDecentralizedIdentity Hook
 *
 * A React hook for managing decentralized identity using the Nostr protocol.
 * Nostr (Notes and Other Stuff Transmitted by Relays) is a decentralized protocol
 * that enables censorship-resistant communication using cryptographic key pairs.
 *
 * Key Concepts:
 * - npub: The public key in bech32 format (human-readable, starts with "npub1")
 * - nsec: The private/secret key in bech32 format (starts with "nsec1")
 * - bech32: An encoding format that provides error detection and is easier to read/copy
 * - Relays: Servers that store and forward Nostr events between clients
 *
 * This hook handles:
 * - Key generation and storage
 * - Connection to Nostr relays
 * - Authentication with existing keys
 * - Session management (login/logout)
 */

import { useState, useEffect, useCallback } from "react";

import { Buffer } from "buffer";
import { bech32 } from "bech32";

import NDK, { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

/**
 * Global NDK (Nostr Development Kit) instance
 * Configured with default relays for event propagation.
 * Using multiple relays ensures redundancy and better message delivery.
 */
const ndk = new NDK({
  explicitRelayUrls: ["wss://relay.damus.io", "wss://relay.primal.net"],
});

console.log("ndk created:", ndk);

export const useDecentralizedIdentity = (initialNpub, initialNsec) => {
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [nostrPubKey, setNostrPubKey] = useState(initialNpub || "");
  const [nostrPrivKey, setNostrPrivKey] = useState(initialNsec || "");

  /**
   * Initialization Effect
   *
   * Runs once on component mount to:
   * 1. Restore any existing session from localStorage
   * 2. Establish connection to Nostr relays
   * 3. Initialize the signer if credentials exist
   *
   * The bech32 decoding process:
   * - bech32.decode() extracts the "words" (5-bit groups) from the encoded string
   * - bech32.fromWords() converts these 5-bit groups back to 8-bit bytes
   * - The result is converted to hex format for use with NDK
   *
   * blockUntilReady() ensures the signer is fully initialized before use,
   * preventing race conditions when signing events.
   */
  useEffect(() => {
    // Load keys from local storage if they exist
    const storedNpub = localStorage.getItem("local_npub");
    const storedNsec = localStorage.getItem("local_nsec");

    if (storedNpub) {
      setNostrPubKey(storedNpub);
    }

    if (storedNsec) {
      setNostrPrivKey(storedNsec);
    }

    const initializeConnection = async () => {
      try {
        await ndk.connect();
        setIsConnected(true);

        if (storedNsec && storedNsec.startsWith("nsec")) {
          const { words: nsecWords } = bech32.decode(storedNsec);
          const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString(
            "hex"
          );
          const signer = new NDKPrivateKeySigner(hexNsec);
          await signer.blockUntilReady();
          ndk.signer = signer;
          const user = await signer.user();
          ndk.activeUser = user;
          console.log("Private key signer initialized");
        }
      } catch (err) {
        console.error("Error connecting to Nostr:", err);
        setErrorMessage(err.message);
      }
    };

    initializeConnection();
  }, []);

  /**
   * Generate New Nostr Key Pair
   *
   * Creates a brand new cryptographic identity for the user. This is the
   * equivalent of "creating an account" in a decentralized system.
   *
   * How it works:
   * 1. NDKPrivateKeySigner.generate() creates a new secp256k1 key pair
   *    (the same elliptic curve used by Bitcoin)
   * 2. The private key (hex) is encoded to bech32 "nsec" format for safe storage
   * 3. The public key is derived and stored as "npub"
   *
   * Security Note:
   * - The nsec (private key) should NEVER be shared - it proves ownership
   * - The npub (public key) can be freely shared - it's your public identity
   * - Keys are stored in localStorage for session persistence
   *
   * @param {string|null} userDisplayName - Optional display name (currently unused)
   * @returns {Object} The generated key pair { npub, nsec }
   */
  const generateNostrKeys = async (userDisplayName = null) => {
    const privateKeySigner = NDKPrivateKeySigner.generate();

    const privateKey = privateKeySigner.privateKey;
    const user = await privateKeySigner.user();

    const publicKey = user.npub;

    const encodedNsec = bech32.encode(
      "nsec",
      bech32.toWords(Buffer.from(privateKey, "hex"))
    );
    setNostrPrivKey(encodedNsec);
    setNostrPubKey(publicKey);

    console.log("encodednsec", encodedNsec);
    localStorage.setItem("local_nsec", encodedNsec);
    localStorage.setItem("local_npub", publicKey);
    localStorage.setItem("uniqueId", publicKey);

    return { npub: publicKey, nsec: encodedNsec };
  };

  /**
   * Connect to Nostr Network
   *
   * Establishes a connection to the Nostr relay network and optionally
   * initializes a signer for creating signed events.
   *
   * Connection Modes:
   * - With nsec (private key): Full read/write access, can sign events
   * - Without nsec: Read-only mode, can only fetch public data
   *
   * Key Resolution Order (falls back through each):
   * 1. Explicitly passed keys (npubRef, nsecRef)
   * 2. Keys from localStorage
   * 3. Keys from React state
   * 4. Default/fallback keys from environment
   *
   * Why create a new NDK instance?
   * Each connection context may need different configurations or
   * isolation from the global instance for specific operations.
   *
   * @param {string|null} npubRef - Optional public key to use
   * @param {string|null} nsecRef - Optional private key to use
   * @returns {Object|null} Connection details { ndkInstance, hexNpub, signer } or null on error
   */
  const connectToNostr = useCallback(
    async (npubRef = null, nsecRef = null) => {
      const defaultNsec = import.meta.env.VITE_GLOBAL_NOSTR_NSEC;
      const defaultNpub =
        "npub1mgt5c7qh6dm9rg57mrp89rqtzn64958nj5w9g2d2h9dng27hmp0sww7u2v";

      const storedNsec = localStorage.getItem("local_nsec");

      const nsec = nsecRef || storedNsec || nostrPrivKey || defaultNsec;
      const npub =
        npubRef ||
        localStorage.getItem("local_npub") ||
        nostrPubKey ||
        defaultNpub;

      try {
        // Decode the npub from Bech32
        const { words: npubWords } = bech32.decode(npub);
        const hexNpub = Buffer.from(bech32.fromWords(npubWords)).toString(
          "hex"
        );

        // Create a new NDK instance
        const ndkInstance = new NDK({
          explicitRelayUrls: ["wss://relay.damus.io", "wss://relay.primal.net"],
        });

        await ndkInstance.connect();

        setIsConnected(true);

        // Handle private key mode
        if (nsec && nsec.startsWith("nsec")) {
          const { words: nsecWords } = bech32.decode(nsec);
          const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString(
            "hex"
          );
          return {
            ndkInstance,
            hexNpub,
            signer: new NDKPrivateKeySigner(hexNsec),
          };
        }

        // No signer available, return without one (read-only mode)
        return { ndkInstance, hexNpub, signer: null };
      } catch (err) {
        console.error("Error connecting to Nostr:", err);
        setErrorMessage(err.message);
        return null;
      }
    },
    [nostrPrivKey, nostrPubKey]
  );

  /**
   * Authenticate with Existing Private Key
   *
   * Logs in a user using their existing nsec (private key). This is the
   * equivalent of "signing in" with existing credentials.
   *
   * Authentication Flow:
   * 1. Decode the bech32 nsec to raw hex format
   * 2. Create a signer object from the private key
   * 3. Derive the public key (npub) from the private key
   * 4. Attach the signer to the global NDK instance
   * 5. Persist credentials in localStorage for session continuity
   *
   * The signer.user() call derives the public key mathematically from
   * the private key - this is a one-way operation (you cannot derive
   * the private key from the public key).
   *
   * @param {string} nsec - The user's private key in bech32 format
   * @returns {Object|null} The authenticated { user, signer } or null on error
   */
  const auth = async (nsec) => {
    try {
      // Decode nsec to hex
      const { words: nsecWords } = bech32.decode(nsec);
      const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString("hex");

      const signer = new NDKPrivateKeySigner(hexNsec);
      await signer.blockUntilReady();
      ndk.signer = signer;

      const user = await signer.user();
      ndk.activeUser = user;

      setNostrPubKey(user.npub);
      setNostrPrivKey(nsec);
      localStorage.setItem("local_npub", user.npub);
      console.log("local_nsec", nsec);
      localStorage.setItem("local_nsec", nsec);
      setErrorMessage(null);

      return { user, signer };
    } catch (error) {
      console.error("Error logging in with keys:", error);
      setErrorMessage(error.message);
      return null;
    }
  };

  /**
   * Ensure Signer is Available
   *
   * A utility function that guarantees a signer is ready for use.
   * Used before any operation that requires signing (publishing events,
   * sending payments, etc.).
   *
   * Resolution Strategy:
   * 1. Return existing signer if already attached to NDK
   * 2. Attempt to restore from localStorage if no signer exists
   * 3. Return null if no credentials are available
   *
   * This lazy initialization pattern allows the app to defer signer
   * creation until actually needed, improving startup performance.
   *
   * @returns {NDKPrivateKeySigner|null} The signer instance or null
   */
  const ensureSigner = async () => {
    if (ndk.signer) return ndk.signer;

    // Try to use stored nsec if available
    const storedNsec = localStorage.getItem("local_nsec");
    if (storedNsec && storedNsec.startsWith("nsec")) {
      try {
        const { words: nsecWords } = bech32.decode(storedNsec);
        const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString(
          "hex"
        );
        const signer = new NDKPrivateKeySigner(hexNsec);
        await signer.blockUntilReady();
        ndk.signer = signer;
        return signer;
      } catch (err) {
        console.error("Failed to initialize signer from stored nsec:", err);
      }
    }

    return null;
  };

  /**
   * Logout / Clear Session
   *
   * Completely clears the user's session by:
   * 1. Removing all credentials from localStorage
   * 2. Clearing React state
   * 3. Detaching the signer from the NDK instance
   *
   * After logout, the user will need to either:
   * - Generate new keys (new identity)
   * - Authenticate with existing keys (login)
   *
   * Note: This does NOT delete the identity from the Nostr network -
   * the keys still exist and can be used to log back in. Nostr
   * identities are permanent unless the private key is lost.
   */
  const logout = () => {
    localStorage.removeItem("local_npub");
    localStorage.removeItem("local_nsec");
    localStorage.removeItem("uniqueId");
    setNostrPubKey("");
    setNostrPrivKey("");
    ndk.signer = null;
    ndk.activeUser = null;
  };

  return {
    isConnected,
    errorMessage,
    nostrPubKey,
    nostrPrivKey,
    generateNostrKeys,
    auth,
    ensureSigner,
    logout,
    ndk,
  };
};
