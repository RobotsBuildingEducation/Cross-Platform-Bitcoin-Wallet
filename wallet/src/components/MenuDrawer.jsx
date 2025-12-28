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
      <DrawerOverlay bg="blackAlpha.300" />
      <DrawerContent bg="white" borderLeftRadius="lg">
        <DrawerHeader borderBottomWidth="1px" py={3}>
          <Text fontSize="lg" fontWeight="semibold" color="gray.800">
            Settings
          </Text>
        </DrawerHeader>

        <DrawerBody py={4}>
          <VStack spacing={3} align="stretch">
            <HStack spacing={2} justify="center">
              <Button
                size="sm"
                leftIcon={<CopyIcon />}
                variant="outline"
                colorScheme="gray"
                onClick={() => copyToClipboard(npub, "ID")}
              >
                Your ID
              </Button>
              <Button
                size="sm"
                leftIcon={<LockIcon />}
                variant="outline"
                colorScheme="gray"
                onClick={() => copyToClipboard(nsec, "Secret key")}
              >
                Secret Key
              </Button>
            </HStack>

            <Button
              w="full"
              variant="ghost"
              color="gray.600"
              fontWeight="normal"
              onClick={onLogout}
              mt={4}
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
