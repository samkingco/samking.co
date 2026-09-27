import {spawnSync} from "node:child_process"
import {Command, InvalidArgumentError} from "commander"

new Command()
	.name("pnpm photos:db:generate")
	.description("Generate a named photo database migration")
	.requiredOption("--name <name>", "Migration name", (name: string) => {
		if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
			throw new InvalidArgumentError(
				"Use a lowercase name starting with a letter, with letters, numbers, hyphens, or underscores.",
			)
		}
		return name
	})
	.action(({name}: {name: string}) => {
		const result = spawnSync(
			"pnpm",
			["exec", "drizzle-kit", "generate", "--name", name],
			{stdio: "inherit"},
		)
		if (result.error) {
			console.error(result.error.message)
		}
		process.exitCode = result.status ?? 1
	})
	.parse()
