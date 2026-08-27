#!/usr/bin/env bun

import { program } from "commander";
import { registerToolsCommand } from "./command";

registerToolsCommand(program);
program.parse();
