#!/bin/bash

# Add all relevant files to git
git add .

# Commit the changes
git commit -m "chore: prepare for release"

# Push to the remote repository
git push origin HEAD:main

# Run npm release
npm run release
