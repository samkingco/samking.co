import {stdout} from "node:process"
import {getRows, Prompt, wrapTextWithPrefix} from "@clack/core"
import {type CommonOptions, S_BAR, S_BAR_END, symbol} from "@clack/prompts"
import type {PlannedRecord} from "../atproto/records.ts"

class RecordPrompt extends Prompt<void> {
	protected _shouldSubmit(): boolean {
		return false
	}
}

/** A bounded detail view, rather than a note that disappears above the next menu. */
export function viewRecord(
	action: string,
	record: PlannedRecord,
	options: CommonOptions = {},
) {
	const output = options.output ?? stdout
	let offset = 0
	let pageSize = 1
	let lineCount = 0
	const prompt = new RecordPrompt(
		{
			...options,
			render() {
				const title = wrapTextWithPrefix(
					output,
					`${action} record · ${record.label}`,
					`${symbol(this.state)}  `,
				)
				if (this.state === "submit" || this.state === "cancel") {
					return `${title}\n`
				}
				const lines = wrapTextWithPrefix(
					output,
					`${record.uri}\n\n${JSON.stringify(record.record, null, 2)}`,
					`${S_BAR}  `,
				).split("\n")
				const help = wrapTextWithPrefix(
					output,
					"↑/↓ scroll · PgUp/PgDn page · Home/End\nEsc back · Ctrl+C exit",
					`${S_BAR}  `,
				).split("\n")
				lineCount = lines.length
				pageSize = Math.max(
					1,
					getRows(output) - title.split("\n").length - help.length - 4,
				)
				offset = Math.min(offset, Math.max(0, lineCount - pageSize))
				const end = Math.min(lineCount, offset + pageSize)
				return [
					title,
					...lines.slice(offset, end),
					`${S_BAR}  Lines ${offset + 1}–${end} of ${lineCount}`,
					...help,
					S_BAR_END,
				].join("\n")
			},
		},
		false,
	)
	prompt.on("cursor", (key) => {
		const distances: Record<string, number> = {
			up: -1,
			down: 1,
			left: -pageSize,
			right: pageSize,
		}
		const distance = distances[key ?? ""]
		offset = Math.max(
			0,
			Math.min(lineCount - pageSize, offset + (distance ?? 0)),
		)
	})
	prompt.on("key", (_char, key) => {
		const positions: Record<string, number> = {
			pageup: offset - pageSize,
			pagedown: offset + pageSize,
			home: 0,
			end: lineCount - pageSize,
		}
		const position = positions[key.name ?? ""]
		if (position !== undefined) {
			offset = Math.max(0, Math.min(lineCount - pageSize, position))
		}
	})
	return prompt.prompt()
}
