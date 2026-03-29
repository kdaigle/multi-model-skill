import { mkdirSync, copyFileSync } from "fs";
import { dirname } from "path";

try {
  const target = "/home/kydaigle/code/multi-model-skill/tests/routing-policy.test.mjs";
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync("/home/kydaigle/code/multi-model-skill/eval/scripts/routing-policy.test.mjs", target);
  console.log("File copied successfully!");
} catch (err) {
  console.error("Error:", err.message);
}
