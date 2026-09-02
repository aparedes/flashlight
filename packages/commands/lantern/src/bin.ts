#!/usr/bin/env bun

import { Logger } from "@lantern/logger";
import { createProgram } from "./cli";

createProgram()
  .parseAsync()
  .catch((error: unknown) => {
    Logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
