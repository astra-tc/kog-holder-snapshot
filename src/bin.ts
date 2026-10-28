#!/usr/bin/env node
import { run } from './cli.js';

run({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
}).then((code) => process.exit(code));
