#!/usr/bin/env node
// Cross-platform setup script: ensures .env exists before starting.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const envPath = path.join(root, '.env')
const envExample = path.join(root, '.env.example')

if (!fs.existsSync(envPath)) {
  if (!fs.existsSync(envExample)) {
    console.error('ERROR: .env.example not found. Cannot create .env.')
    process.exit(1)
  }
  fs.copyFileSync(envExample, envPath)
  console.log('.env created from .env.example')
  console.log('ACTION REQUIRED: Set your GITHUB_TOKEN and verify DATABASE_URL in .env before running again.')
  process.exit(1)
}

console.log('.env found.')
