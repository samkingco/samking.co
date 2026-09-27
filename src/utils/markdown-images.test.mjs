import assert from "node:assert/strict"
import {test} from "node:test"
import {satteri} from "@astrojs/markdown-satteri"
import {parse} from "node-html-parser"
import {markdownImages} from "./markdown-images.mjs"

const renderer = await satteri({hastPlugins: [markdownImages]}).createRenderer({
	syntaxHighlight: false,
})

test("Markdown images retain their image, alt text, and caption", async () => {
	const {code} = await renderer.render(
		'![Alt](https://example.com/a.jpg "Caption")',
	)
	const figure = parse(code).querySelector("figure")
	const img = figure.querySelector("img")
	assert.equal(img.getAttribute("src"), "https://example.com/a.jpg")
	assert.equal(img.getAttribute("alt"), "Alt")
	assert.equal(figure.querySelector("figcaption").text, "Caption")
})
