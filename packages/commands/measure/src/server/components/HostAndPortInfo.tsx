import { getInk } from "../ink";

export const HostAndPortInfo = ({ url }: { url: string }) => {
  const { Box, Text } = getInk();

  return (
    <Box padding={1} flexDirection="column">
      <Text>
        <Text bold>Flashlight web app running on: </Text>
        <Text color={"blue"}>{url}</Text>
      </Text>
    </Box>
  );
};
