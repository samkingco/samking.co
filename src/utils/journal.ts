import {getCollection} from "astro:content"

export async function getJournalEntries() {
	const [posts, notes] = await Promise.all([
		getCollection("posts"),
		getCollection("notes"),
	])
	const entries = [...posts, ...notes]
	const tids = new Set<string>()
	for (const entry of entries) {
		if (tids.has(entry.data.tid)) {
			throw new Error(`Duplicate journal TID "${entry.data.tid}"`)
		}
		tids.add(entry.data.tid)
	}
	return entries.toSorted((a, b) =>
		a.data.tid < b.data.tid ? 1 : a.data.tid > b.data.tid ? -1 : 0,
	)
}
