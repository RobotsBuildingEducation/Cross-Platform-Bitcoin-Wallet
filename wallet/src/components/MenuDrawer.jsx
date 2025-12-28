import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  VStack,
  Button,
  useToast,
  Divider,
} from "@chakra-ui/react";
import { CopyIcon } from "@chakra-ui/icons";

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
    <Drawer isOpen={isOpen} placement="right" onClose={onClose}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerCloseButton />
        <DrawerHeader>Menu</DrawerHeader>

        <DrawerBody>
          <VStack spacing={4} align="stretch">
            <Button
              leftIcon={<CopyIcon />}
              variant="outline"
              onClick={() => copyToClipboard(npub, "ID")}
            >
              Copy ID
            </Button>
            <Button
              leftIcon={<CopyIcon />}
              variant="outline"
              onClick={() => copyToClipboard(nsec, "Secret key")}
            >
              Copy Secret Key
            </Button>
            <Divider />
            <Button colorScheme="red" variant="ghost" onClick={onLogout}>
              Logout
            </Button>
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default MenuDrawer;
