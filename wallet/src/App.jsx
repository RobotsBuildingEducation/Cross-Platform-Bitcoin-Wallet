import { useEffect, useMemo, useState } from "react";
import "./App.css";
import useBitcoinWalletStore from "./hooks/useBitcoinWalletStore";
import { useDecentralizedIdentity } from "./hooks/useDecentralizedIdentity";

function App() {
  const { generateNostrKeys, auth } = useDecentralizedIdentity(
    localStorage.getItem("local_npub"),
    localStorage.getItem("local_nsec")
  );

  // State - individual selectors
  const cashuWallet = useBitcoinWalletStore((state) => state.cashuWallet);
  const walletBalance = useBitcoinWalletStore((state) => state.walletBalance);
  const invoice = useBitcoinWalletStore((state) => state.invoice);
  const isCreatingWallet = useBitcoinWalletStore(
    (state) => state.isCreatingWallet
  );

  // Actions - grabbed once, stable references
  const { createNewWallet, initiateDeposit, init, initWallet, send } =
    useBitcoinWalletStore.getState();

  const [hydrating, setHydrating] = useState(true);
  const [selectedIdentity, setSelectedIdentity] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const connected = await init();
        if (connected) {
          await initWallet();
        }
      } catch (e) {
        console.warn("Wallet hydrate failed:", e);
      } finally {
        if (alive) setHydrating(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [init, initWallet]);

  useEffect(() => {
    setSelectedIdentity(selectedIdentity);
  }, [selectedIdentity]);

  const totalBalance = useMemo(() => {
    const numeric = Number(walletBalance);
    return Number.isFinite(numeric) ? numeric : 0;
  }, [walletBalance]);

  const handleCreateWallet = async () => {
    try {
      await createNewWallet();
    } catch (err) {
      console.error("Error creating wallet:", err);
    }
  };

  const handleInitiateDeposit = async () => {
    if (!selectedIdentity) return;
    try {
      await initiateDeposit(10); // example amount
    } catch (err) {
      console.error("Error initiating deposit:", err);
    }
  };

  const zap = () => {
    send(selectedIdentity);
  };

  return <>hello world</>;
}
export default App;
