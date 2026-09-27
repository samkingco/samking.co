import {isCancel, log, multiline, multiselect} from "@clack/prompts"
import {
	readCollections,
	saveCollectionDescription,
} from "../repos/photos/collections.ts"
import {
	openPhotoDatabase,
	type PhotoDatabase,
} from "../repos/photos/database.ts"

type CollectionRow = ReturnType<typeof readCollections>[number]

type CollectionChoice = {label: string; value: CollectionRow; hint: string}

export async function editCollectionDescriptions(): Promise<void> {
	const database = openPhotoDatabase()
	using _ = database.$client
	const rows = readCollections(database)

	if (rows.length === 0) {
		throw new Error("No collections are ingested")
	}

	const choices = collectionChoices(rows)
	const selected = await multiselect({
		message: "Select collections to edit",
		maxItems: 20,
		options: choices,
		required: false,
	})

	if (isCancel(selected)) {
		return
	}

	if (selected.length === 0) {
		log.info("No collections selected.")
		return
	}

	await editDescriptions(database, selected)
}

async function editDescriptions(
	database: PhotoDatabase,
	rows: CollectionRow[],
): Promise<void> {
	for (const row of rows) {
		const description = await multiline({
			message: `${row.name} description`,
			initialValue: row.description,
			showSubmit: true,
		})

		if (isCancel(description)) {
			log.info("Cancelled. Earlier saves are kept; this item was not saved.")
			return
		}

		if (description === row.description) {
			continue
		}

		saveCollectionDescription(database, row.id, description)
	}
	log.success("Collection descriptions saved.")
}

function collectionChoices(rows: CollectionRow[]): CollectionChoice[] {
	const ids = new Set(rows.map(({id}) => id))
	const childrenByParent = Map.groupBy(rows, ({parentId}) => parentId)
	return rows
		.filter(({parentId}) => !ids.has(parentId))
		.flatMap((row) => collectionBranchChoices(row, childrenByParent))
}

function collectionBranchChoices(
	row: CollectionRow,
	childrenByParent: ReadonlyMap<string, CollectionRow[]>,
	prefix = "",
	branch = "",
): CollectionChoice[] {
	const children = childrenByParent.get(row.id) ?? []
	return [
		{
			label: `${prefix}${branch}${row.name}`,
			value: row,
			hint: `${row.kind} · ${row.id}`,
		},
		...children.flatMap((child, index) =>
			collectionBranchChoices(
				child,
				childrenByParent,
				prefix + (branch === "" ? "" : branch === "└─ " ? "   " : "│  "),
				index === children.length - 1 ? "└─ " : "├─ ",
			),
		),
	]
}
