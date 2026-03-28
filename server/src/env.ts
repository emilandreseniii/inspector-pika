import dotenv from 'dotenv'
import path from 'path'

// Load .env from the monorepo root regardless of cwd
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
