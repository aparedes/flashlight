#!/usr/bin/env bun

import { program } from "commander";
import { registerTestCommand } from "./command";

registerTestCommand(program);
program.parse();
