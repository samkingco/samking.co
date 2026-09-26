export const markdownImages = {
	name: "markdown-images",
	element: {
		filter: ["img", "p"],
		visit(node, ctx) {
			if (node.tagName === "img") {
				// Auto uses the rendered width, including the content column's cap.
				// Older browsers fall back to the viewport width.
				if (node.properties.loading == null) {
					ctx.setProperty(node, "loading", "lazy")
				}
				if (
					node.properties.loading == null ||
					node.properties.loading === "lazy"
				) {
					if (node.properties.sizes == null) {
						ctx.setProperty(node, "sizes", "auto, 100vw")
					}
				}
			}

			const img = node.children?.length === 1 ? node.children[0] : undefined
			if (
				node.tagName !== "p" ||
				img?.type !== "element" ||
				img.tagName !== "img"
			) {
				return
			}
			const title = img.properties.title
			if (typeof title !== "string" || !title) return

			const {title: _title, ...properties} = img.properties
			properties.loading ??= "lazy"
			if (properties.loading === "lazy") properties.sizes ??= "auto, 100vw"

			ctx.replaceNode(node, {
				type: "element",
				tagName: "figure",
				properties: {},
				children: [
					{type: "element", tagName: "img", properties, children: []},
					{
						type: "element",
						tagName: "figcaption",
						properties: {},
						children: [{type: "text", value: title}],
					},
				],
			})
		},
	},
}
