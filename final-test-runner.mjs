#!/usr/bin/env node

import { mkdirSync, copyFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

async function main() {
  try {
    // 1. Create the tests directory
    const testDir = "/home/kydaigle/code/multi-model-skill/tests";
    mkdirSync(testDir, { recursive: true });
    console.log(`✓ Created directory: ${testDir}`);

    // 2. Copy or create the test file  
    const testFile = `${testDir}/routing-policy.test.mjs`;
    const sourceFile = "/home/kydaigle/code/multi-model-skill/eval/scripts/routing-policy.test.mjs";
    
    try {
      copyFileSync(sourceFile, testFile);
      console.log(`✓ Copied test file to: ${testFile}`);
    } catch (err) {
      console.log(`Note: Could not copy from scripts, will create fresh`);
      // File was already created by us, so just use the eval/scripts one
      throw new Error(`Need to use eval/scripts version at: ${sourceFile}`);
    }

    // 3. Run the tests
    console.log("\n--- Running tests ---\n");
    try {
      const { stdout } = await execPromise(
        `node --test ${testFile} 2>&1 | tail -100`
      );
      console.log(stdout);
    } catch (err) {
      // node --test returns non-zero on test failures, but we still want output
      if (err.stdout) {
        console.log(err.stdout);
      }
      if (err.stderr) {
        console.error(err.stderr);
      }
    }
  } catch (error) {
    console.error("Setup error:", error.message);
    console.log("\nAttempting to run from eval/scripts location...");
    try {
      const { stdout } = await execPromise(
        `node --test /home/kydaigle/code/multi-model-skill/eval/scripts/routing-policy.test.mjs 2>&1 | tail -100`
      );
      console.log(stdout);
    } catch (err) {
      if (err.stdout) {
        console.log(err.stdout);
      }
      if (err.stderr) {
        console.error(err.stderr);
      }
    }
  }
}

main();
