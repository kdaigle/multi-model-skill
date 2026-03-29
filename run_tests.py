#!/usr/bin/env python3

import os
import subprocess
import shutil

# Create tests directory
test_dir = "/home/kydaigle/code/multi-model-skill/tests"
os.makedirs(test_dir, exist_ok=True)
print(f"✓ Created directory: {test_dir}")

# Define file paths
test_file = f"{test_dir}/routing-policy.test.mjs"
source_file = "/home/kydaigle/code/multi-model-skill/eval/scripts/routing-policy.test.mjs"

# Copy or create test file
try:
    shutil.copy(source_file, test_file)
    print(f"✓ Copied test file to: {test_file}")
except Exception as e:
    print(f"Could not copy: {e}")
    print(f"Will try running from: {source_file}")
    test_file = source_file

# Run tests
print("\n--- Running tests ---\n")
try:
    result = subprocess.run(
        ["node", "--test", test_file],
        capture_output=True,
        text=True,
        timeout=30
    )
    output = result.stdout + result.stderr
    
    # Show last 100 lines
    lines = output.split('\n')
    for line in lines[-100:]:
        print(line)
        
except subprocess.TimeoutExpired:
    print("Test execution timed out")
except Exception as e:
    print(f"Error running tests: {e}")
