import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  VStack,
  Button,
  HStack,
  useToast,
  Text,
} from "@chakra-ui/react";
import { CopyIcon, LockIcon } from "@chakra-ui/icons";

function MenuDrawer({ isOpen, onClose, npub, nsec, onLogout }) {
  const toast = useToast();

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

  return (
    <Drawer isOpen={isOpen} placement="right" onClose={onClose} size="xs">
      <DrawerOverlay bg="blackAlpha.600" />
      <DrawerContent
        bg="black"
        borderLeftRadius="xl"
        maxH="auto"
        h="auto"
        position="absolute"
        top={0}
        right={0}
        m={0}
      >
        <DrawerHeader py={3}>
          <Text fontSize="md" fontWeight="semibold" color="white">
            Settings
          </Text>
        </DrawerHeader>

        <DrawerBody py={4} pb={6}>
          <VStack spacing={3} align="stretch">
            <HStack spacing={2} justify="center">
              <Button
                size="sm"
                leftIcon={<CopyIcon />}
                variant="outline"
                borderColor="gray.600"
                color="white"
                _hover={{ bg: "gray.800" }}
                onClick={() => copyToClipboard(npub, "ID")}
              >
                Your ID
              </Button>
              <Button
                size="sm"
                leftIcon={<LockIcon />}
                variant="outline"
                borderColor="gray.600"
                color="white"
                _hover={{ bg: "gray.800" }}
                onClick={() => copyToClipboard(nsec, "Secret key")}
              >
                Secret Key
              </Button>
            </HStack>

            <Button
              w="full"
              variant="ghost"
              color="gray.400"
              fontWeight="normal"
              _hover={{ bg: "gray.800", color: "white" }}
              onClick={onLogout}
              mt={2}
            >
              Sign Out
            </Button>
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default MenuDrawer;
