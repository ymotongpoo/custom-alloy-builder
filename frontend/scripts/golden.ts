import { readFile, readdir } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ComponentSchema } from "../src/schema/types.ts"
import type { IRConfig } from "../src/ir/types.ts"
import { serialize } from "../src/river/serialize.ts"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../..")
const goldenDir = join(repoRoot, "testdata/golden")

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 1) {
    const config = await readConfig(resolve(process.cwd(), args[0]))
    process.stdout.write(serialize(config, await loadSchemas(config)))
    return
  }

  if (args.length !== 0) {
    throw new Error("usage: npm run golden -- [testdata/golden/<name>.ir.json]")
  }

  const fixtureNames = await listFixtureNames()
  const failures: string[] = []

  for (const name of fixtureNames) {
    const irPath = join(goldenDir, `${name}.ir.json`)
    const alloyPath = join(goldenDir, `${name}.alloy`)
    const [actual, expected] = await Promise.all([
      readConfig(irPath).then(async (config) => serialize(config, await loadSchemas(config))),
      readFile(alloyPath, "utf8"),
    ])

    if (actual !== expected) {
      failures.push(name)
      process.stderr.write(`golden mismatch: ${relative(repoRoot, alloyPath)}\n`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`golden check failed for ${failures.length} fixture(s)`)
  }

  process.stdout.write(`golden ok: ${fixtureNames.length} fixture(s)\n`)
}

async function loadSchemas(config: IRConfig): Promise<Record<string, ComponentSchema>> {
  const entries = await Promise.all(
    Array.from(new Set(config.components.map((component) => component.type))).map(async (type) => {
      const schemaPath = join(repoRoot, "schemas", config.alloyVersion, "components", `${type}.json`)
      return [type, JSON.parse(await readFile(schemaPath, "utf8")) as ComponentSchema] as const
    }),
  )
  return Object.fromEntries(entries)
}

async function readConfig(path: string): Promise<IRConfig> {
  return JSON.parse(await readFile(path, "utf8")) as IRConfig
}

async function listFixtureNames(): Promise<string[]> {
  const entries = await readdir(goldenDir)
  return entries
    .filter((entry) => entry.endsWith(".ir.json"))
    .map((entry) => basename(entry, ".ir.json"))
    .sort()
}

await main()
