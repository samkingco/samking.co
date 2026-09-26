import assert from "node:assert/strict"
import {test} from "node:test"
import {satteri} from "@astrojs/markdown-satteri"
import {parse} from "node-html-parser"
import {markdownImages} from "./markdown-images.mjs"

const renderer = await satteri({hastPlugins: [markdownImages]}).createRenderer({
	syntaxHighlight: false,
})

test("titled images become figures with lazy loading", async () => {
	const {code} = await renderer.render(
		'![Alt](https://example.com/a.jpg "Caption")',
	)
	const figure = parse(code).querySelector("figure")
	const img = figure.querySelector("img")
	assert.equal(img.getAttribute("title"), undefined)
	assert.equal(img.getAttribute("loading"), "lazy")
	assert.equal(img.getAttribute("sizes"), "auto, 100vw")
	assert.equal(figure.querySelector("figcaption").text, "Caption")
})

test("untitled images are lazy unless loading is explicit", async () => {
	const {code} = await renderer.render(
		'![Alt](https://example.com/a.jpg)\n\n<img src="/a.jpg" loading="eager">',
	)
	const [lazy, eager] = parse(code).querySelectorAll("img")
	assert.equal(lazy.getAttribute("loading"), "lazy")
	assert.equal(lazy.getAttribute("sizes"), "auto, 100vw")
	assert.equal(eager.getAttribute("loading"), "eager")
	assert.equal(eager.getAttribute("sizes"), undefined)
})
