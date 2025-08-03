import { visitParents } from "unist-util-visit-parents";

export function rehypeImageCaptions() {
  return (tree) => {
    visitParents(tree, "element", (node) => {
      // Look for paragraphs containing only an image
      if (
        node.tagName === "p" &&
        node.children &&
        node.children.length === 1 &&
        node.children[0].type === "element" &&
        node.children[0].tagName === "img"
      ) {
        const img = node.children[0];
        const title = img.properties?.title;

        // If image has a title, transform to figure with figcaption
        if (title) {
          // Remove title from img properties to avoid duplication
          delete img.properties.title;

          // Transform paragraph to figure
          node.tagName = "figure";

          // Add figcaption after the image
          node.children.push({
            type: "element",
            tagName: "figcaption",
            children: [
              {
                type: "text",
                value: title,
              },
            ],
          });
        }
      }
    });
  };
}
