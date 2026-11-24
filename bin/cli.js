#!/usr/bin/env node
import { run } from "../dist/index.js";

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  },
);
