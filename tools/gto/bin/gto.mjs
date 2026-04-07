#!/usr/bin/env node

import { runCli } from '../src/gt_office_cli.js'

const { stdin, stdout, stderr, env } = process
const exitCode = await runCli(process.argv.slice(2), { stdin, stdout, stderr, env })
process.exitCode = exitCode
