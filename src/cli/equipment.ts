import {groupMultiselect, isCancel, log, select, text} from "@clack/prompts"
import {
	openPhotoDatabase,
	type PhotoDatabase,
} from "../repos/photos/database.ts"
import {
	type EquipmentAlias,
	readEquipment,
	readEquipmentAliases,
	saveEquipmentAlias,
} from "../repos/photos/equipment.ts"

export async function editEquipment(): Promise<void> {
	const database = openPhotoDatabase()
	using _ = database.$client
	const equipment = readEquipment(database)
	const aliases = readEquipmentAliases(database)
	if (equipment.length === 0) {
		log.info("No equipment found in active ingested photos.")
		return
	}

	const options = equipment
		.sort((left, right) => left.sourceName.localeCompare(right.sourceName))
		.map((item) => {
			const alias = aliases.get(`${item.kind}:${item.sourceName}`)
			return {
				value: item,
				label: alias?.displayName ?? item.sourceName,
				hint:
					alias && alias.displayName !== item.sourceName
						? item.sourceName
						: undefined,
			}
		})
	const selected = await groupMultiselect({
		message: "Select equipment to edit",
		options: {
			Cameras: options.filter(({value}) => value.kind === "camera"),
			Lenses: options.filter(({value}) => value.kind === "lens"),
		},
		required: false,
	})
	if (isCancel(selected)) {
		return
	}

	for (const item of selected) {
		const alias = aliases.get(`${item.kind}:${item.sourceName}`) ?? {
			...item,
			displayName: item.sourceName,
			focalLengthDisplay: "native",
		}
		if (!(await editItem(database, alias))) {
			break
		}
	}
}

async function editItem(
	database: PhotoDatabase,
	item: EquipmentAlias,
): Promise<boolean> {
	const displayName = await text({
		message: `Display name for ${item.sourceName}`,
		initialValue: item.displayName,
		validate: (value) => (value?.trim() ? undefined : "Enter a display name."),
	})
	if (isCancel(displayName)) {
		return false
	}

	let focalLengthDisplay = item.focalLengthDisplay
	if (item.kind === "camera") {
		const selectedMode = await select({
			message: `Focal length display for ${item.sourceName}`,
			initialValue: focalLengthDisplay,
			options: [
				{value: "native", label: "Native"},
				{value: "35mm", label: "35mm"},
			],
		})
		if (isCancel(selectedMode)) {
			return false
		}
		focalLengthDisplay = selectedMode
	}

	saveEquipmentAlias(database, {
		...item,
		displayName: displayName.trim(),
		focalLengthDisplay,
	})
	log.success(`Saved ${item.sourceName}.`)
	return true
}
