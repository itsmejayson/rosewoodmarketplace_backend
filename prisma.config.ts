import { defineConfig } from 'prisma/config'
import { readFileSync } from 'fs'
import { resolve } from 'path'

let datasourceUrl = process.env.DATABASE_URL

if (!datasourceUrl) {
  try {
    const envContent = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
    const match = envContent.match(/^DATABASE_URL\s*=\s*["']?(.+?)["']?\s*$/m)
    if (match) datasourceUrl = match[1]
  } catch {}
}

export default defineConfig({
  migrations: {
    seed: 'node src/prisma/seed.js',
  },
  datasource: {
    url: datasourceUrl,
  },
})
