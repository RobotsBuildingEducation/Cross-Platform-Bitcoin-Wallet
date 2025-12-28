import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Input,
  useToast,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Spinner,
  IconButton,
  Flex,
  Badge,
} from "@chakra-ui/react";
import { CopyIcon, CheckIcon } from "@chakra-ui/icons";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";
import useBitcoinWalletStore from "./hooks/useBitcoinWalletStore";
import { useDecentralizedIdentity } from "./hooks/useDecentralizedIdentity";

function App() {
  const {
    generateNostrKeys,
    auth,
    logout,
    nostrPubKey,
    nostrPrivKey,
    isConnected,
    errorMessage: identityError,
  } = useDecentralizedIdentity(
    localStorage.getItem("local_npub"),
    localStorage.getItem("local_nsec")
  );

  // Wallet store state
  const cashuWallet = useBitcoinWalletStore((state) => state.cashuWallet);
  const walletBalance = useBitcoinWalletStore((state) => state.walletBalance);
  const invoice = useBitcoinWalletStore((state) => state.invoice);
  const isCreatingWallet = useBitcoinWalletStore(
    (state) => state.isCreatingWallet
  );
  const isWalletReady = useBitcoinWalletStore((state) => state.isWalletReady);
  const walletError = useBitcoinWalletStore((state) => state.errorMessage);

  // Wallet store actions
  const {
    createNewWallet,
    initiateDeposit,
    init,
    initWallet,
    send,
    resetState,
    verifyAndUpdateBalance,
  } = useBitcoinWalletStore.getState();

  // Local state
  const [hydrating, setHydrating] = useState(true);
  const [nsecInput, setNsecInput] = useState("");
  const [depositAmount, setDepositAmount] = useState("10");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const toast = useToast();

  // Check if user is authenticated
  const isAuthenticated = useMemo(() => {
    return !!(nostrPubKey && nostrPrivKey);
  }, [nostrPubKey, nostrPrivKey]);

  // Initialize on mount
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
  }, []);

  // Calculate balance
  const totalBalance = useMemo(() => {
    const numeric = Number(walletBalance);
    return Number.isFinite(numeric) ? numeric : 0;
  }, [walletBalance]);

  // Handle logout
  const handleLogout = () => {
    logout();
    resetState();
    toast({
      title: "Logged out",
      status: "info",
      duration: 2000,
    });
  };

  // Handle create account
  const handleCreateAccount = async () => {
    setIsCreatingAccount(true);
    try {
      const keys = await generateNostrKeys();
      if (keys) {
        toast({
          title: "Account created!",
          description: "Your new Nostr identity has been generated.",
          status: "success",
          duration: 3000,
        });
        // Re-initialize wallet connection
        await init();
      }
    } catch (err) {
      toast({
        title: "Error creating account",
        description: err.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setIsCreatingAccount(false);
    }
  };

  // Handle sign in with existing key
  const handleSignIn = async () => {
    if (!nsecInput.trim()) {
      toast({
        title: "Please enter your nsec",
        status: "warning",
        duration: 3000,
      });
      return;
    }

    if (!nsecInput.startsWith("nsec")) {
      toast({
        title: "Invalid key format",
        description: "Key must start with 'nsec'",
        status: "error",
        duration: 3000,
      });
      return;
    }

    setIsSigningIn(true);
    try {
      const result = await auth(nsecInput);
      if (result) {
        toast({
          title: "Signed in successfully!",
          status: "success",
          duration: 3000,
        });
        setNsecInput("");
        // Re-initialize wallet connection
        await init();
        await initWallet();
      } else {
        toast({
          title: "Sign in failed",
          description: "Please check your private key",
          status: "error",
          duration: 5000,
        });
      }
    } catch (err) {
      toast({
        title: "Error signing in",
        description: err.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  // Handle create wallet
  const handleCreateWallet = async () => {
    try {
      const wallet = await createNewWallet();
      if (wallet) {
        toast({
          title: "Wallet created!",
          description: "Your Bitcoin wallet is ready.",
          status: "success",
          duration: 3000,
        });
      }
    } catch (err) {
      toast({
        title: "Error creating wallet",
        description: err.message,
        status: "error",
        duration: 5000,
      });
    }
  };

  // Handle deposit
  const handleDeposit = async () => {
    const amount = parseInt(depositAmount, 10);
    if (isNaN(amount) || amount < 1) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount (minimum 1 sat)",
        status: "warning",
        duration: 3000,
      });
      return;
    }

    setIsDepositing(true);
    try {
      await initiateDeposit(amount, {
        onSuccess: (newBalance) => {
          toast({
            title: "Deposit successful!",
            description: `New balance: ${newBalance} sats`,
            status: "success",
            duration: 5000,
          });
          setIsDepositing(false);
        },
        onError: (e) => {
          toast({
            title: "Deposit failed",
            description: e.message,
            status: "error",
            duration: 5000,
          });
          setIsDepositing(false);
        },
      });
    } catch (err) {
      toast({
        title: "Error initiating deposit",
        description: err.message,
        status: "error",
        duration: 5000,
      });
      setIsDepositing(false);
    }
  };

  // Handle send 1 sat
  const handleSend = async () => {
    if (totalBalance < 1) {
      toast({
        title: "Insufficient balance",
        description: "You need at least 1 sat to send",
        status: "warning",
        duration: 3000,
      });
      return;
    }

    setIsSending(true);
    try {
      const success = await send();
      if (success) {
        toast({
          title: "Sent 1 sat!",
          status: "success",
          duration: 3000,
        });
        await verifyAndUpdateBalance();
      } else {
        toast({
          title: "Send failed",
          description: walletError || "Please try again",
          status: "error",
          duration: 5000,
        });
      }
    } catch (err) {
      toast({
        title: "Error sending",
        description: err.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setIsSending(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "invoice") {
        setCopiedInvoice(true);
        setTimeout(() => setCopiedInvoice(false), 2000);
      } else {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      toast({
        title: "Copied!",
        status: "success",
        duration: 1500,
      });
    } catch (err) {
      toast({
        title: "Failed to copy",
        status: "error",
        duration: 2000,
      });
    }
  };

  // Loading state
  if (hydrating) {
    return (
      <Container centerContent py={20}>
        <VStack spacing={4}>
          <Spinner size="xl" color="orange.500" />
          <Text>Loading...</Text>
        </VStack>
      </Container>
    );
  }

  // Auth page (not authenticated)
  if (!isAuthenticated) {
    return (
      <Container maxW="md" py={10}>
        <VStack spacing={8}>
          <Heading size="lg" textAlign="center">
            Bitcoin Wallet
          </Heading>
          <Text color="gray.500" textAlign="center">
            Create a new account or sign in with your existing Nostr key
          </Text>

          {/* Create Account Card */}
          <Card w="100%">
            <CardHeader>
              <Heading size="md">Create Account</Heading>
            </CardHeader>
            <CardBody>
              <VStack spacing={4}>
                <Text fontSize="sm" color="gray.500">
                  Generate a new Nostr identity and Bitcoin wallet
                </Text>
                <Button
                  colorScheme="orange"
                  size="lg"
                  w="100%"
                  onClick={handleCreateAccount}
                  isLoading={isCreatingAccount}
                  loadingText="Creating..."
                >
                  Create New Account
                </Button>
              </VStack>
            </CardBody>
          </Card>

          <HStack w="100%" align="center">
            <Divider />
            <Text px={4} color="gray.500" fontSize="sm">
              OR
            </Text>
            <Divider />
          </HStack>

          {/* Sign In Card */}
          <Card w="100%">
            <CardHeader>
              <Heading size="md">Sign In</Heading>
            </CardHeader>
            <CardBody>
              <VStack spacing={4}>
                <Text fontSize="sm" color="gray.500">
                  Enter your existing Nostr private key (nsec)
                </Text>
                <Input
                  placeholder="nsec1..."
                  value={nsecInput}
                  onChange={(e) => setNsecInput(e.target.value)}
                  type="password"
                />
                <Button
                  colorScheme="blue"
                  size="lg"
                  w="100%"
                  onClick={handleSignIn}
                  isLoading={isSigningIn}
                  loadingText="Signing in..."
                >
                  Sign In
                </Button>
              </VStack>
            </CardBody>
          </Card>

          {identityError && (
            <Text color="red.500" fontSize="sm">
              {identityError}
            </Text>
          )}
        </VStack>
      </Container>
    );
  }

  // Wallet page (authenticated)
  return (
    <Container maxW="md" py={6}>
      <VStack spacing={6}>
        {/* Header */}
        <Flex w="100%" justify="space-between" align="center">
          <Heading size="lg">Bitcoin Wallet</Heading>
          <Button size="sm" variant="ghost" onClick={handleLogout}>
            Logout
          </Button>
        </Flex>

        {/* User Info */}
        <Card w="100%">
          <CardBody>
            <VStack spacing={2} align="start">
              <Text fontSize="sm" color="gray.500">
                Your Public Key (npub)
              </Text>
              <HStack w="100%">
                <Text fontSize="xs" isTruncated flex={1}>
                  {nostrPubKey}
                </Text>
                <IconButton
                  size="sm"
                  icon={copied ? <CheckIcon /> : <CopyIcon />}
                  onClick={() => copyToClipboard(nostrPubKey, "npub")}
                  aria-label="Copy npub"
                />
              </HStack>
              <Badge colorScheme={isConnected ? "green" : "red"}>
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </VStack>
          </CardBody>
        </Card>

        {/* Balance Card */}
        <Card w="100%" bg="orange.50">
          <CardBody>
            <VStack spacing={2}>
              <Text fontSize="sm" color="gray.600">
                Balance
              </Text>
              <Heading size="2xl" color="orange.600">
                {totalBalance} sats
              </Heading>
            </VStack>
          </CardBody>
        </Card>

        {/* Create Wallet (if no wallet exists) */}
        {!isWalletReady && !cashuWallet && (
          <Card w="100%">
            <CardBody>
              <VStack spacing={4}>
                <Text>You don't have a wallet yet.</Text>
                <Button
                  colorScheme="orange"
                  size="lg"
                  w="100%"
                  onClick={handleCreateWallet}
                  isLoading={isCreatingWallet}
                  loadingText="Creating wallet..."
                >
                  Create Wallet
                </Button>
              </VStack>
            </CardBody>
          </Card>
        )}

        {/* Wallet Actions (if wallet exists) */}
        {(isWalletReady || cashuWallet) && (
          <>
            {/* Deposit Section */}
            <Card w="100%">
              <CardHeader>
                <Heading size="md">Deposit</Heading>
              </CardHeader>
              <CardBody>
                <VStack spacing={4}>
                  <HStack w="100%">
                    <Input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="Amount in sats"
                      min={1}
                    />
                    <Button
                      colorScheme="green"
                      onClick={handleDeposit}
                      isLoading={isDepositing}
                      loadingText="..."
                    >
                      Deposit
                    </Button>
                  </HStack>

                  {/* QR Code and Invoice */}
                  {invoice && (
                    <VStack spacing={4} w="100%" pt={4}>
                      <Text fontSize="sm" color="gray.500">
                        Scan QR code or copy invoice
                      </Text>
                      <Box
                        p={4}
                        bg="white"
                        borderRadius="md"
                        border="1px solid"
                        borderColor="gray.200"
                      >
                        <QRCodeSVG value={invoice} size={200} />
                      </Box>
                      <VStack w="100%" spacing={2}>
                        <Text
                          fontSize="xs"
                          wordBreak="break-all"
                          bg="gray.100"
                          p={2}
                          borderRadius="md"
                          maxH="100px"
                          overflow="auto"
                        >
                          {invoice}
                        </Text>
                        <Button
                          size="sm"
                          leftIcon={
                            copiedInvoice ? <CheckIcon /> : <CopyIcon />
                          }
                          onClick={() => copyToClipboard(invoice, "invoice")}
                          variant="outline"
                        >
                          {copiedInvoice ? "Copied!" : "Copy Invoice"}
                        </Button>
                      </VStack>
                    </VStack>
                  )}
                </VStack>
              </CardBody>
            </Card>

            {/* Send Section */}
            <Card w="100%">
              <CardHeader>
                <Heading size="md">Send</Heading>
              </CardHeader>
              <CardBody>
                <VStack spacing={4}>
                  <Text fontSize="sm" color="gray.500">
                    Send 1 sat to the default recipient
                  </Text>
                  <Button
                    colorScheme="blue"
                    size="lg"
                    w="100%"
                    onClick={handleSend}
                    isLoading={isSending}
                    loadingText="Sending..."
                    isDisabled={totalBalance < 1}
                  >
                    Send 1 Sat
                  </Button>
                </VStack>
              </CardBody>
            </Card>
          </>
        )}

        {/* Error Display */}
        {(walletError || identityError) && (
          <Text color="red.500" fontSize="sm">
            {walletError || identityError}
          </Text>
        )}
      </VStack>
    </Container>
  );
}

export default App;
