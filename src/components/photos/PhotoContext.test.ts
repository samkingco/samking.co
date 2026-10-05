import assert from "node:assert/strict"
import {test} from "node:test"
import {adjacentPhotoHref, type PhotoContext} from "./PhotoContext.ts"

test("adjacent URLs use contextual neighbors and retain browser return sorting", () => {
	const context: PhotoContext = {
		path: "/photos/sets/manual/",
		label: "",
		reference: {type: "set", id: "manual"},
		index: 2,
		total: 3,
		previousId: "first",
		nextId: "last",
	}
	const search = new URLSearchParams({sort: "title", direction: "ascending"})
	for (const direction of [-1, 1] as const) {
		const href = adjacentPhotoHref(context, direction, search)
		assert.ok(href)
		const url = new URL(href, "https://photos.invalid")
		assert.equal(
			url.pathname,
			direction < 0 ? "/photos/first/" : "/photos/last/",
		)
		assert.equal(url.searchParams.get("ctx"), "set")
		assert.equal(url.searchParams.get("ctxid"), "manual")
		assert.equal(url.searchParams.get("sort"), "title")
		assert.equal(url.searchParams.get("direction"), "ascending")
	}
	assert.equal(adjacentPhotoHref(undefined, 1, search), null)
	assert.equal(adjacentPhotoHref({...context, nextId: null}, 1, search), null)
})
