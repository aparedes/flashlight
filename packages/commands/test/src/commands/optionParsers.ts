import { InvalidArgumentError } from "commander";
import { POLLING_INTERVAL } from "@lantern/types";

/** `Number` rather than `parseInt` so that "10abc" is rejected instead of silently becoming 10 */
export const parsePositiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
};

export const parseNonNegativeInteger = (value: string): number => {
  // `Number("")` is 0, so blank input has to be rejected explicitly
  const parsed = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return parsed;
};

/** Measures are sliced by polling interval, so a duration must be a whole number of intervals */
export const parseDuration = (value: string): number => {
  const parsed = parsePositiveInteger(value);
  if (parsed % POLLING_INTERVAL !== 0) {
    throw new InvalidArgumentError(
      `Expected a multiple of the measure interval (${POLLING_INTERVAL}ms).`
    );
  }
  return parsed;
};

const BIT_RATE_PATTERN = /^(\d+)([Mm])?$/;

/** Bits per second, either as plain bits ("4000000") or megabits ("4M"), like `adb screenrecord` */
export const parseBitRate = (value: string): number => {
  const match = BIT_RATE_PATTERN.exec(value.trim());
  const parsed = match ? Number(match[1]) * (match[2] ? 1_000_000 : 1) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      'Expected a positive bit rate in bits ("4000000") or megabits ("4M").'
    );
  }
  return parsed;
};
