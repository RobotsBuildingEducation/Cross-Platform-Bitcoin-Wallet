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
  Flex,
  Badge,
  Link,
  Stack,
  Center,
} from "@chakra-ui/react";
import {
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  LockIcon,
} from "@chakra-ui/icons";
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
  const [isDepositing, setIsDepositing] = useState(false);
  const [isSending, setIsSending] = useState(false);
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

  // Handle deposit (always 10 sats)
  const handleDeposit = async () => {
    const amount = 10;

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

  // Copy invoice to clipboard
  const copyInvoice = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 2000);
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

  // Copy to clipboard helper
  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: `${label} copied!`,
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

          {/* Create Account */}
          <Card w="100%">
            <CardBody>
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
            </CardBody>
          </Card>

          <HStack w="100%" align="center">
            <Divider />
            <Text px={4} color="gray.500" fontSize="sm">
              OR
            </Text>
            <Divider />
          </HStack>

          {/* Sign In */}
          <Card w="100%">
            <CardBody>
              <VStack spacing={4}>
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
    <Container py={6}>
      <Stack>
        {/* Header */}
        <Flex w="100%" justify="center" align="center">
          <HStack spacing={2}>
            <Heading size="lg">Bitcoin Wallet</Heading>
          </HStack>
        </Flex>

        {/* Balance Card */}
        <Card w="100%" bg="orange.50">
          <CardBody textAlign={"center"}>
            <Center spacing={2}>
              <Heading color="gray.600">Balance:&nbsp;</Heading>
              <Heading color="orange.600">{totalBalance} sats</Heading>
            </Center>
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
              <CardBody>
                <VStack spacing={4}>
                  <Button
                    colorScheme="green"
                    size="lg"
                    w="fit-content"
                    padding={24}
                    onClick={handleDeposit}
                    isLoading={isDepositing}
                    loadingText="..."
                    mb={24}
                  >
                    Deposit 10 sats
                  </Button>

                  {/* QR Code and Invoice */}
                  {invoice && (
                    <VStack spacing={4} w="100%" pt={4}>
                      <Box
                        p={4}
                        bg="white"
                        borderRadius="md"
                        border="1px solid"
                        borderColor="gray.200"
                      >
                        <QRCodeSVG value={invoice} size={200} />
                      </Box>
                      <Button
                        leftIcon={copiedInvoice ? <CheckIcon /> : <CopyIcon />}
                        onClick={() => copyInvoice(invoice)}
                        variant="outline"
                        w="fit-content"
                        padding={24}
                        mt={12}
                      >
                        {copiedInvoice ? "Copied!" : "Copy Invoice"}
                      </Button>
                    </VStack>
                  )}
                </VStack>
              </CardBody>
            </Card>

            {/* Send Section */}
            <Card>
              <CardBody>
                <VStack spacing={4}>
                  <Button
                    colorScheme="blue"
                    size="lg"
                    w="fit-content"
                    padding={24}
                    onClick={handleSend}
                    isLoading={isSending}
                    loadingText="Sending..."
                    isDisabled={totalBalance < 1}
                  >
                    Send 1 Sat
                  </Button>
                  <Link
                    href="https://nutlife.lol"
                    isExternal
                    color="orange.500"
                    fontSize="sm"
                    mt={48}
                    border="1px solid blue"
                    padding={12}
                  >
                    Verify your transactions
                  </Link>
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

        {/* Account Actions */}
        <Divider my={4} />
        <VStack spacing={16} justify="center" wrap="wrap">
          <Button
            size="sm"
            leftIcon={<CopyIcon />}
            variant="outline"
            onClick={() => copyToClipboard(nostrPubKey, "ID")}
            width="200px"
            padding={16}
          >
            Your ID
          </Button>
          <Button
            size="sm"
            leftIcon={<LockIcon />}
            variant="outline"
            onClick={() => copyToClipboard(nostrPrivKey, "Secret Key")}
            width="200px"
            padding={16}
          >
            Secret Key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color="gray.500"
            onClick={handleLogout}
            width="200px"
            padding={16}
          >
            Sign Out
          </Button>
        </VStack>
      </Stack>
    </Container>
  );
}

export default App;
