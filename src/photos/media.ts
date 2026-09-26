import {createHash} from "node:crypto"
import {copyFile, mkdir, readFile, stat, writeFile} from "node:fs/promises"
import {dirname, extname} from "node:path"
import {extractColorsFromImageData} from "extract-colors"
import sharp, {type Metadata, type Sharp} from "sharp"
import {extractMetadata} from "./metadata.ts"
import {createPhotoOpenGraphImage} from "./open-graph.ts"
import type {NormalizedMetadata, PhotoDerivativeKind} from "./schema.ts"

export type PreparedDerivative = {
	kind: PhotoDerivativeKind
	path: string
	sha256: string
	byteSize: number
	mimeType: "image/jpeg" | "image/webp"
	width: number
	height: number
}

export type PreparedPhoto = {
	source: PreparedDerivative
	normalized: NormalizedMetadata
	rawMetadata: string
	derivatives: PreparedDerivative[]
}

async function writePhotoOpenGraphAsset(
	image: Buffer,
	path: string,
): Promise<PreparedDerivative> {
	const output = await createPhotoOpenGraphImage(image)
	await mkdir(dirname(path), {recursive: true})
	await writeFile(path, output)
	return {
		kind: "og",
		path,
		sha256: sha256(output),
		byteSize: output.byteLength,
		mimeType: "image/jpeg",
		width: 1200,
		height: 630,
	}
}

export async function preparePhotoOpenGraph(
	inputPath: string,
	outputPath: string,
): Promise<PreparedDerivative> {
	return writePhotoOpenGraphAsset(await readFile(inputPath), outputPath)
}

export async function preparePhoto(
	exportPath: string,
	outputPaths: ReadonlyMap<PhotoDerivativeKind, string>,
): Promise<PreparedPhoto> {
	assertJpegPath(exportPath)
	const buffer = await readFile(exportPath)
	assertJpegBuffer(buffer, exportPath)

	const [imageMetadata, colors] = await Promise.all([
		sharp(buffer).metadata(),
		extractColorMetadata(buffer),
	])
	const {width, height} = imageDimensions(imageMetadata, exportPath)
	const {normalized, raw} = extractMetadata(buffer, width, height, colors)
	const sourceStats = await stat(exportPath)
	const source: PreparedDerivative = {
		kind: "source",
		path: exportPath,
		sha256: sha256(buffer),
		byteSize: sourceStats.size,
		mimeType: "image/jpeg",
		width,
		height,
	}
	const derivatives: PreparedDerivative[] = []

	const sourcePath = outputPaths.get("source")
	if (sourcePath) {
		await mkdir(dirname(sourcePath), {recursive: true})
		await copyFile(exportPath, sourcePath)
		derivatives.push({...source, path: sourcePath})
	}

	const responsiveDerivatives: Array<
		readonly [kind: "thumb" | "detail", size: number]
	> = [
		["thumb", 1024],
		["detail", 3072],
	]
	for (const [kind, size] of responsiveDerivatives) {
		const path = outputPaths.get(kind)
		if (!path) {
			continue
		}
		await mkdir(dirname(path), {recursive: true})
		let pipeline = sharp(buffer)
			.resize({
				width: size,
				height: size,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({quality: 70})
		pipeline = addRightsMetadata(pipeline, normalized)
		const info = await pipeline.toFile(path)
		const output = await readFile(path)
		derivatives.push({
			kind,
			path,
			sha256: sha256(output),
			byteSize: info.size,
			mimeType: "image/webp",
			width: info.width,
			height: info.height,
		})
	}

	const openGraphPath = outputPaths.get("og")
	if (openGraphPath) {
		derivatives.push(await writePhotoOpenGraphAsset(buffer, openGraphPath))
	}

	return {
		source,
		normalized,
		rawMetadata: raw,
		derivatives,
	}
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex")
}

function assertJpegPath(path: string): void {
	if (!/^\.jpe?g$/i.test(extname(path))) {
		throw new Error(`Unsupported photo type: ${path}`)
	}
}

function assertJpegBuffer(buffer: Buffer, path: string): void {
	const hasJpegHeader =
		buffer.length >= 3 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xd8 &&
		buffer[2] === 0xff

	if (!hasJpegHeader) {
		throw new Error(`Invalid JPEG: ${path}`)
	}
}

function imageDimensions(
	metadata: Metadata,
	path: string,
): {width: number; height: number} {
	if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
		throw new Error(`Invalid JPEG: ${path}`)
	}

	if (Math.max(metadata.width, metadata.height) > 4096) {
		throw new Error(
			`Expected at most a 4096px longest edge: ${path} is ${metadata.width}x${metadata.height}`,
		)
	}

	return {width: metadata.width, height: metadata.height}
}

async function extractColorMetadata(
	buffer: Buffer,
): Promise<Pick<NormalizedMetadata, "dominantColor" | "palette">> {
	const {data, info} = await sharp(buffer)
		.rotate()
		.resize({width: 64, height: 64, fit: "inside"})
		.toColourspace("srgb")
		.ensureAlpha()
		.raw()
		.toBuffer({resolveWithObject: true})

	const pixels = new Uint8ClampedArray(
		data.buffer,
		data.byteOffset,
		data.byteLength,
	)

	const colors = extractColorsFromImageData(
		{data: pixels, width: info.width, height: info.height},
		{pixels: info.width * info.height, distance: 0.25},
	).sort((left, right) => right.area - left.area)

	const palette = colors
		.filter((color) => color.area >= 0.01)
		.slice(0, 8)
		.map((color) => ({
			hex: color.hex,
			weight: Number(color.area.toFixed(6)),
		}))

	return {
		dominantColor: palette[0]?.hex ?? null,
		palette,
	}
}

function addRightsMetadata(
	pipeline: Sharp,
	metadata: NormalizedMetadata,
): Sharp {
	const artist = metadata.creator ?? metadata.credit
	const copyright = metadata.copyright ?? metadata.license
	if (artist || copyright) {
		pipeline = pipeline.withExif({
			IFD0: {
				...(artist ? {Artist: artist} : {}),
				...(copyright ? {Copyright: copyright} : {}),
			},
		})
	}

	const xmpFields = [
		metadata.creator,
		metadata.creatorUrl,
		metadata.credit,
		metadata.copyright,
		metadata.license,
		metadata.usageTerms,
		metadata.attributionUrl,
	]

	if (xmpFields.some(Boolean)) {
		pipeline = pipeline.withXmp(buildXmp(metadata))
	}

	return pipeline
}

function buildXmp(metadata: NormalizedMetadata): string {
	const fields: string[] = []
	if (metadata.creator) {
		fields.push(
			`<dc:creator><rdf:Seq><rdf:li>${xml(metadata.creator)}</rdf:li></rdf:Seq></dc:creator>`,
		)
	}

	if (metadata.credit) {
		fields.push(`<photoshop:Credit>${xml(metadata.credit)}</photoshop:Credit>`)
	}

	if (metadata.copyright) {
		fields.push(
			`<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xml(metadata.copyright)}</rdf:li></rdf:Alt></dc:rights>`,
		)
	}

	if (metadata.license) {
		fields.push(`<cc:license rdf:resource="${xml(metadata.license)}"/>`)
	}

	if (metadata.usageTerms) {
		fields.push(
			`<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${xml(metadata.usageTerms)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>`,
		)
	}

	if (metadata.attributionUrl) {
		fields.push(
			`<xmpRights:WebStatement>${xml(metadata.attributionUrl)}</xmpRights:WebStatement>`,
		)
	}

	if (metadata.creatorUrl) {
		fields.push(
			`<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiUrlWork="${xml(metadata.creatorUrl)}"/>`,
		)
	}

	return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:cc="http://creativecommons.org/ns#" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">${fields.join("")}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;")
}
