#!/usr/bin/env node
import { Command } from 'commander'
import { registerConnect } from './commands/connect.js'
import { registerStatus } from './commands/status.js'
import { registerContext } from './commands/context.js'
import { registerSearch } from './commands/search.js'
import { registerDoctor } from './commands/doctor.js'
import { registerSync } from './commands/sync.js'
import { registerInit } from './commands/init.js'
import { registerMcp } from './commands/mcp.js'
import { PilotError } from '../core/errors.js'

const program = new Command('pilot').description('Connect your rutter to AI coding agents')
for (const reg of [registerInit, registerConnect, registerSync, registerStatus,
  registerDoctor, registerContext, registerSearch, registerMcp]) reg(program)

program.parseAsync().catch((e: unknown) => {
  if (e instanceof PilotError) {
    console.error(`오류: ${e.message}${e.hint ? `\n힌트: ${e.hint}` : ''}`)
    process.exit(1)
  }
  throw e
})
