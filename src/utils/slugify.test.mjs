import assert from "node:assert/strict"
import test from "node:test"
import {slugify} from "./slugify.ts"

test("slugs keep existing URL spelling across names and titles", () => {
	assert.equal(slugify("  Crème brûlée! "), "creme-brulee")
	assert.equal(slugify("Fujifilm GFX50S II"), "fujifilm-gfx50s-ii")
	assert.equal(slugify('A "quoted" title'), "a-quoted-title")
	assert.equal(slugify("🔥"), "")
})
