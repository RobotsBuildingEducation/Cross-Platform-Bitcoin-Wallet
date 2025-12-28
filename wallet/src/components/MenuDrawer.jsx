import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverArrow,
  VStack,
  Button,
  HStack,
  IconButton,
  useToast,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { CopyIcon, LockIcon, HamburgerIcon } from "@chakra-ui/icons";

function MenuDrawer({ npub, nsec, onLogout }) {
  const toast = useToast();
  const { isOpen, onToggle, onClose } = useDisclosure();

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

  const handleLogout = () => {
    onClose();
    onLogout();
  };

  return (
    <Popover isOpen={isOpen} onClose={onClose} placement="bottom-end">
      <PopoverTrigger>
        <IconButton
          icon={<HamburgerIcon />}
          variant="ghost"
          onClick={onToggle}
          aria-label="Open menu"
          size="lg"
        />
      </PopoverTrigger>
      <PopoverContent
        bg="black"
        borderColor="gray.700"
        borderRadius="xl"
        w="auto"
        minW="200px"
      >
        <PopoverArrow bg="black" />
        <PopoverHeader borderBottomWidth="1px" borderColor="gray.700" py={3}>
          <Text fontSize="md" fontWeight="semibold" color="white">
            Settings
          </Text>
        </PopoverHeader>

        <PopoverBody py={4}>
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
              onClick={handleLogout}
              mt={2}
            >
              Sign Out
            </Button>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

export default MenuDrawer;
