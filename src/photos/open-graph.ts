import sharp from "sharp"

export async function createPhotoOpenGraphImage(
	image: Buffer,
): Promise<Buffer> {
	return sharp(image)
		.resize({
			width: 1120,
			height: 550,
			fit: "contain",
			background: "#000000",
		})
		.extend({
			top: 40,
			bottom: 40,
			left: 40,
			right: 40,
			background: "#000000",
		})
		.jpeg({quality: 95})
		.toBuffer()
}
