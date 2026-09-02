import { InvalidArgumentError } from "commander";
import { POLLING_INTERVAL } from "@lantern/types";

const parseInterval = (value: string, { allowZero }: { allowZero: boolean }): number => {
  // `Number` rather than `parseInt` so that "10abc" is rejected instead of silently becoming 10,
  // and `Number("")` is 0 so blank input has to be rejected explicitly
  const parsed = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new InvalidArgumentError(
      allowZero ? "Expected a non-negative integer." : "Expected a positive integer."
    );
  }
  if (parsed % POLLING_INTERVAL !== 0) {
    throw new InvalidArgumentError(
      `Expected a multiple of the measure interval (${POLLING_INTERVAL}ms).`
    );
  }
  return parsed;
};

/** Measures are sliced by polling interval, so a duration must be a whole number of intervals */
export const parseDuration = (value: string): number => parseInterval(value, { allowZero: false });

export const parseSkip = (value: string): number => parseInterval(value, { allowZero: true });
