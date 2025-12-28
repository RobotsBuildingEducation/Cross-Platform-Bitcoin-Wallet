import { useState, useEffect, useCallback } from "react";

import { Buffer } from "buffer";
import { bech32 } from "bech32";

import NDK, { NDKPrivateKeySigner, NDKNip07Signer } from "@nostr-dev-kit/ndk";

const ndk = new NDK({
  explicitRelayUrls: ["wss://relay.damus.io", "wss://relay.primal.net"],
});

console.log("ndk created:", ndk);

export const useDecentralizedIdentity = (initialNpub, initialNsec) => {
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [nostrPubKey, setNostrPubKey] = useState(initialNpub || "");
  const [nostrPrivKey, setNostrPrivKey] = useState(initialNsec || "");

  useEffect(() => {
    // Load keys from local storage if they exist
    const storedNpub = localStorage.getItem("local_npub");
    const storedNsec = localStorage.getItem("local_nsec");
    const isNip07 = localStorage.getItem("nip07_signer") === "true";

    if (storedNpub) {
      setNostrPubKey(storedNpub);
    }

    if (storedNsec && storedNsec !== "nip07") {
      setNostrPrivKey(storedNsec);
    }

    const initializeConnection = async () => {
      try {
        await ndk.connect();
        setIsConnected(true);

        if (isNip07 && typeof window !== "undefined" && window.nostr) {
          const signer = new NDKNip07Signer();
          await signer.blockUntilReady();
          ndk.signer = signer;
          const user = await signer.user();
          ndk.activeUser = user; // Add this
          console.log("NIP-07 signer initialized");
        } else if (
          storedNsec &&
          storedNsec !== "nip07" &&
          storedNsec.startsWith("nsec")
        ) {
          const { words: nsecWords } = bech32.decode(storedNsec);
          const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString(
            "hex"
          );
          const signer = new NDKPrivateKeySigner(hexNsec);
          await signer.blockUntilReady();
          ndk.signer = signer;
          const user = await signer.user();
          ndk.activeUser = user; // Add this
          console.log("Private key signer initialized");
        }
      } catch (err) {
        console.error("Error connecting to Nostr:", err);
        setErrorMessage(err.message);
      }
    };

    initializeConnection();
  }, []);

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

  const connectToNostr = useCallback(
    async (npubRef = null, nsecRef = null) => {
      const defaultNsec = import.meta.env.VITE_GLOBAL_NOSTR_NSEC;
      const defaultNpub =
        "npub1mgt5c7qh6dm9rg57mrp89rqtzn64958nj5w9g2d2h9dng27hmp0sww7u2v";

      const storedNsec = localStorage.getItem("local_nsec");
      const isNip07 = localStorage.getItem("nip07_signer") === "true";

      const nsec =
        nsecRef ||
        (storedNsec !== "nip07" ? storedNsec : null) ||
        nostrPrivKey ||
        defaultNsec;
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

        // Handle NIP-07 mode - use extension signer
        if (isNip07 && typeof window !== "undefined" && window.nostr) {
          const signer = new NDKNip07Signer();
          await signer.blockUntilReady();
          return { ndkInstance, hexNpub, signer };
        }

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

  const auth = async (nsec) => {
    try {
      // Decode nsec to hex
      const { words: nsecWords } = bech32.decode(nsec);
      const hexNsec = Buffer.from(bech32.fromWords(nsecWords)).toString("hex");

      const signer = new NDKPrivateKeySigner(hexNsec);
      await signer.blockUntilReady();
      ndk.signer = signer;

      const user = await signer.user();
      ndk.activeUser = user; // Add this line

      setNostrPubKey(user.npub);
      setNostrPrivKey(nsec);
      localStorage.setItem("local_npub", user.npub);
      console.log("local_nsec", nsec);
      localStorage.setItem("local_nsec", nsec);
      localStorage.removeItem("nip07_signer");
      setErrorMessage(null);

      return { user, signer };
    } catch (error) {
      console.error("Error logging in with keys:", error);
      setErrorMessage(error.message);
      return null;
    }
  };

  const isNip07Available = () => {
    return typeof window !== "undefined" && window.nostr;
  };

  const isNip07Mode = () => {
    return (
      typeof window !== "undefined" &&
      localStorage.getItem("nip07_signer") === "true"
    );
  };

  // Helper to ensure the signer is ready (initializes NIP-07 signer if needed)
  const ensureSigner = async () => {
    if (ndk.signer) return ndk.signer;

    if (isNip07Mode() && isNip07Available()) {
      const signer = new NDKNip07Signer();
      await signer.blockUntilReady();
      ndk.signer = signer;
      return signer;
    }

    // Try to use stored nsec if available
    const storedNsec = localStorage.getItem("local_nsec");
    if (storedNsec && storedNsec !== "nip07" && storedNsec.startsWith("nsec")) {
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

  const authWithExtension = async () => {
    try {
      if (!isNip07Available()) {
        throw new Error(
          "No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby."
        );
      }

      const signer = new NDKNip07Signer();
      await signer.blockUntilReady();
      ndk.signer = signer;

      const user = await signer.user();
      ndk.activeUser = user; // Add this
      const npub = user.npub;

      setNostrPubKey(npub);
      setNostrPrivKey(""); // No private key with NIP-07
      localStorage.setItem("local_npub", npub);
      localStorage.setItem("local_nsec", "nip07"); // Marker to indicate NIP-07 mode
      localStorage.setItem("nip07_signer", "true");
      localStorage.setItem("uniqueId", npub);
      setErrorMessage(null);

      return { user, signer };
    } catch (error) {
      console.error("Error logging in with NIP-07 extension:", error);
      setErrorMessage(error.message);
      return null;
    }
  };

  return {
    isConnected,
    errorMessage,
    nostrPubKey,
    nostrPrivKey,
    generateNostrKeys,
    auth,
    authWithExtension,
    isNip07Available,
    isNip07Mode,
    ensureSigner,
    ndk,
  };
};
