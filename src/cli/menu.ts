import {type CommonOptions, isCancel, log, select} from "@clack/prompts"

type MenuAction = {label: string; hint?: string; run: () => Promise<unknown>}

export async function menu(
	message: string,
	actions: MenuAction[],
	options: CommonOptions & {root?: boolean} = {},
): Promise<void> {
	let cursor = 0
	while (!options.signal?.aborted) {
		const selected = await select({
			...options,
			message,
			initialValue: cursor,
			options: actions.map(({label, hint}, value) => ({label, hint, value})),
		})
		if (isCancel(selected) && !options.root) {
			return
		}
		if (isCancel(selected)) {
			continue
		}
		cursor = selected
		try {
			await actions[selected]!.run()
		} catch (error) {
			log.error(errorMessage(error), options)
		}
	}
}

export function errorMessage(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error)
	}
	if (error.name === "DrizzleQueryError" && error.cause instanceof Error) {
		return errorMessage(error.cause)
	}
	return error.message
}
