#!/usr/bin/env node
import { createWriteStream } from "fs";
import { spawn } from "child_process";

const output = createWriteStream("/tmp/test-results.txt");

const proc = spawn("node", ["--test", "/home/kydaigle/code/multi-model-skill/eval/scripts/routing-policy.test.mjs"]);

proc.stdout.pipe(output);
proc.stderr.pipe(output);

proc.on("close", (code) => {
  output.write(`\n\n=== Test process exited with code: ${code} ===\n`);
  output.end();
  console.log(`Tests completed. Results written to /tmp/test-results.txt`);
});
