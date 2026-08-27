#!/usr/bin/env bun

import { program } from "commander";
import { registerReportCommand } from "./command";

registerReportCommand(program);
program.parse();
