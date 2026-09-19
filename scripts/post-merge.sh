#!/bin/bash
set -e
pnpm install --frozen-lockfile
echo "Dependencies installed. Database changes are never applied automatically."
echo "For a new empty database run: pnpm db:bootstrap"
echo "For an existing database review changes, back up, then run: pnpm db:migrate"
