#!/usr/bin/env bun

import { program } from "commander";
import { registerMeasureCommand } from "./command";

registerMeasureCommand(program);
program.parse();
