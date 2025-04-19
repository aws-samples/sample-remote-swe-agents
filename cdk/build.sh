#!/bin/bash
set -e  # Exit immediately if a command exits with a non-zero status

# Get the directory that this file exists in
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Building packages..."

# Move to packages/common and build the project
echo "Building @remote-swe-agents/common..."
cd "$PROJECT_ROOT/packages/common"
npm install
npm run build

# Move to packages/slack-bolt-app and build the project
echo "Building slack-bolt-app..."
cd "$PROJECT_ROOT/packages/slack-bolt-app"
npm install
npm run bundle

# Move to packages/worker and build the project
echo "Building worker..."
cd "$PROJECT_ROOT/packages/worker"
npm install
npm run bundle

# Return to the original directory
cd "$SCRIPT_DIR"
echo "All packages built successfully!"
