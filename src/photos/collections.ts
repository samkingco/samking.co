import {input, select} from "@inquirer/prompts"
import {asc, eq} from "drizzle-orm"
import {collections} from "./database-schema.ts"
import {openPhotoDatabase, type PhotoDatabase} from "./database.ts"

type CollectionRow = Pick<
	typeof collections.$inferSelect,
	"id" | "parentId" | "name" | "kind" | "description"
>

type CollectionChoice = {name: string; value: string}

export async function editCollectionDescriptions(): Promise<void> {
	const startedAt = Date.now()
	const database = openPhotoDatabase()

	try {
		const rows = database
			.select({
				id: collections.id,
				parentId: collections.parentId,
				name: collections.name,
				kind: collections.kind,
				description: collections.description,
			})
			.from(collections)
			.orderBy(asc(collections.parentId), asc(collections.position))
			.all()

		console.log(
			`Loaded ${rows.length} collections in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
		)

		if (rows.length === 0) {
			throw new Error("No collections are ingested")
		}

		const choices = collectionChoices(rows)
		const id = await select({
			message: "Start with which collection?",
			pageSize: 20,
			choices: [...choices, {name: "Cancel", value: ""}],
		})

		if (!id) {
			return
		}

		const start = choices.findIndex(({value}) => value === id)
		await editDescriptions(database, rows, choices.slice(start))
	} finally {
		database.$client.close()
	}
}

async function editDescriptions(
	database: PhotoDatabase,
	rows: CollectionRow[],
	choices: CollectionChoice[],
): Promise<void> {
	for (const choice of choices) {
		const row = rows.find(({id}) => id === choice.value)

		if (!row) {
			throw new Error(`Collection ${choice.value} was not found`)
		}

		const description = await input({
			message: `${choice.name} description (Enter to keep and continue)`,
			default: row.description,
		})

		if (description === row.description) {
			continue
		}

		database
			.update(collections)
			.set({description})
			.where(eq(collections.id, row.id))
			.run()
	}
}

function collectionChoices(rows: CollectionRow[]): CollectionChoice[] {
	const ids = new Set(rows.map(({id}) => id))
	return rows
		.filter(({parentId}) => !ids.has(parentId))
		.flatMap((row) => collectionBranchChoices(row, rows))
}

function collectionBranchChoices(
	row: CollectionRow,
	rows: CollectionRow[],
	depth = 0,
): CollectionChoice[] {
	return [
		{
			name: `${"  ".repeat(depth)}${row.name} [${row.kind}] ${row.id}`,
			value: row.id,
		},
		...rows
			.filter(({parentId}) => parentId === row.id)
			.flatMap((child) => collectionBranchChoices(child, rows, depth + 1)),
	]
}
