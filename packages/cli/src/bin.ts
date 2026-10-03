#!/usr/bin/env node
import { run } from "./index.js";

process.exitCode = await run(process.argv.slice(2), {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
});
