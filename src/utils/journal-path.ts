export function journalPath(entry: {
	collection: "posts" | "notes"
	id: string
}): string {
	return entry.collection === "notes"
		? `/journal/note/${entry.id}/`
		: `/journal/${entry.id}/`
}
