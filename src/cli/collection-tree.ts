import {styleText} from "node:util"
import {Prompt} from "@clack/core"
import {
	type CommonOptions,
	limitOptions,
	S_BAR,
	S_BAR_END,
	symbol,
} from "@clack/prompts"
import type {CaptureOneCollection} from "../repos/photos/capture-one.ts"

type Collection = Pick<
	CaptureOneCollection,
	"id" | "parentId" | "name" | "kind"
>
type Row = {collection: Collection; depth: number}
type SelectionState = "selected" | "included" | "partial" | "empty"

export class CollectionTree {
	readonly collections: Collection[]
	readonly byId: Map<string, Collection>
	readonly children: Map<string, Collection[]>
	readonly selected: Set<string>
	readonly expanded = new Set<string>()
	cursor = 0

	constructor(collections: Collection[], initial: Iterable<string>) {
		this.collections = collections
		this.byId = new Map(
			collections.map((collection) => [collection.id, collection]),
		)
		this.children = Map.groupBy(collections, ({parentId}) => parentId)
		this.selected = new Set([...initial].filter((id) => this.byId.has(id)))
		for (const id of this.selected) {
			if (this.selectedAncestor(id)) {
				this.selected.delete(id)
			}
			for (const ancestor of this.ancestors(id)) {
				this.expanded.add(ancestor.id)
			}
		}
	}

	get visible(): Row[] {
		return this.collections
			.filter(({parentId}) => !this.byId.has(parentId))
			.flatMap((collection) => this.branch(collection, 0))
	}

	private branch(collection: Collection, depth: number): Row[] {
		const children = this.expanded.has(collection.id)
			? (this.children.get(collection.id) ?? [])
			: []
		return [
			{collection, depth},
			...children.flatMap((child) => this.branch(child, depth + 1)),
		]
	}

	private ancestors(id: string): Collection[] {
		const ancestors: Collection[] = []
		let parent = this.byId.get(this.byId.get(id)!.parentId)
		while (parent) {
			ancestors.push(parent)
			parent = this.byId.get(parent.parentId)
		}
		return ancestors
	}

	selectedAncestor(id: string): Collection | undefined {
		return this.ancestors(id).find((ancestor) => this.selected.has(ancestor.id))
	}

	state(id: string): SelectionState {
		if (this.selected.has(id)) {
			return "selected"
		}
		if (this.selectedAncestor(id)) {
			return "included"
		}
		const partial = [...this.selected].some((selected) =>
			this.ancestors(selected).some((ancestor) => ancestor.id === id),
		)
		return partial ? "partial" : "empty"
	}

	toggle(id: string): void {
		if (this.selectedAncestor(id)) {
			return
		}
		if (this.selected.delete(id)) {
			return
		}
		for (const selected of this.selected) {
			if (this.ancestors(selected).some((ancestor) => ancestor.id === id)) {
				this.selected.delete(selected)
			}
		}
		this.selected.add(id)
	}

	move(key: string): void {
		const rows = this.visible
		const row = rows[this.cursor]
		if (!row) {
			return
		}
		const {id} = row.collection
		switch (key) {
			case "up":
				this.cursor = Math.max(0, this.cursor - 1)
				break
			case "down":
				this.cursor = Math.min(rows.length - 1, this.cursor + 1)
				break
			case "right":
				this.open(id)
				break
			case "left":
				this.close(row.collection, rows)
				break
			case "space":
				this.toggle(id)
		}
	}

	private close(collection: Collection, rows: Row[]): void {
		if (
			!this.expanded.delete(collection.id) &&
			this.byId.has(collection.parentId)
		) {
			this.cursor = rows.findIndex(
				({collection: row}) => row.id === collection.parentId,
			)
		}
	}

	private open(id: string): void {
		if (!this.children.has(id)) {
			return
		}
		if (this.expanded.has(id)) {
			this.cursor++
		} else {
			this.expanded.add(id)
		}
	}
}

const markers: Record<SelectionState, string> = {
	selected: "■",
	included: "✓",
	partial: "-",
	empty: "□",
}

function rowLabel(tree: CollectionTree, row: Row, accessible: boolean): string {
	const {id, name, kind} = row.collection
	const state = tree.state(id)
	const branch = tree.children.has(id)
		? tree.expanded.has(id)
			? "▾"
			: "▸"
		: " "
	const marker = accessible ? `[${state}]` : markers[state]
	const inherited = tree.selectedAncestor(id)
	const hint = inherited ? `included via ${inherited.name}` : kind
	return `${"  ".repeat(row.depth)}${branch} ${marker} ${name} (${hint})`
}

export function selectCollections(
	collections: Collection[],
	initial: Iterable<string>,
	options: CommonOptions = {},
) {
	const tree = new CollectionTree(collections, initial)
	const prompt = new Prompt<string[]>(
		{
			...options,
			initialValue: [...tree.selected],
			render() {
				const title = `${symbol(this.state)}  Choose collections to sync`
				if (this.state === "cancel") {
					return `${title}\n${S_BAR}  Selection unchanged.\n${S_BAR_END}`
				}
				if (this.state === "submit") {
					return `${title}\n${S_BAR}  ${tree.selected.size} selected\n`
				}
				const rows = limitOptions({
					options: tree.visible,
					cursor: tree.cursor,
					maxItems: 16,
					output: options.output,
					rowPadding: 5,
					style: (row, active) => {
						const label = rowLabel(tree, row, this.accessible)
						return `${S_BAR}  ${active ? styleText("cyan", `> ${label}`) : `  ${label}`}`
					},
				})
				return [
					title,
					...rows,
					`${S_BAR}  ↑/↓ move · ←/→ close/open · Space select`,
					`${S_BAR}  Enter save · Esc back · Ctrl+C exit`,
					S_BAR_END,
				].join("\n")
			},
		},
		false,
	)
	prompt.value = [...tree.selected]
	prompt.on("cursor", (key) => {
		if (key) {
			tree.move(key)
		}
		prompt.value = [...tree.selected]
	})
	return prompt.prompt()
}
