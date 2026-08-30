import { PlayArrow, Stop } from "@mui/icons-material";
import { Button } from "@lantern/web-reporter-ui";

export const StartButton = ({
  isMeasuring,
  start,
  stop,
}: {
  isMeasuring: boolean;
  start: () => void;
  stop: () => void;
}) =>
  isMeasuring ? (
    <Button onClick={stop} icon={<Stop />}>
      Stop Measuring
    </Button>
  ) : (
    <Button onClick={start} icon={<PlayArrow />}>
      Start Measuring
    </Button>
  );
