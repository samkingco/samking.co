import {createReadStream} from "node:fs"
import {
	DeleteObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import * as v from "valibot"

const R2ConfigSchema = v.object({
	endpoint: v.pipe(v.string(), v.url()),
	accessKeyId: v.pipe(v.string(), v.minLength(1)),
	secretAccessKey: v.pipe(v.string(), v.minLength(1)),
	bucket: v.pipe(v.string(), v.minLength(1)),
	backupBucket: v.pipe(v.string(), v.minLength(1)),
})

export type R2Config = v.InferOutput<typeof R2ConfigSchema>

export const PHOTO_CDN_URL = "https://cdn.samking.co"

const CONNECTION_ERRORS = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EPIPE",
	"TimeoutError",
])

export function isR2ConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}
	const {code, $metadata} = error as Error & {
		code?: string
		$metadata?: {httpStatusCode?: number}
	}
	if ($metadata?.httpStatusCode) {
		return false
	}
	return (
		CONNECTION_ERRORS.has(code ?? error.name) ||
		isR2ConnectionError(error.cause)
	)
}

export function loadR2Config(): R2Config {
	return v.parse(R2ConfigSchema, {
		endpoint: process.env.R2_ENDPOINT,
		accessKeyId: process.env.R2_ACCESS_KEY_ID,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
		bucket: process.env.R2_BUCKET,
		backupBucket: process.env.R2_BACKUP_BUCKET,
	})
}

export function createR2Client(config: R2Config): S3Client {
	return new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	})
}
export async function uploadR2File(input: {
	client: S3Client
	config: R2Config
	path: string
	key: string
	byteSize: number
	mimeType: string
	sha256: string
}): Promise<"uploaded" | "reused"> {
	try {
		const remote = await input.client.send(
			new HeadObjectCommand({Bucket: input.config.bucket, Key: input.key}),
		)
		if (
			remote.Metadata?.sha256 === input.sha256 &&
			remote.ContentLength === input.byteSize &&
			remote.ContentType === input.mimeType
		) {
			return "reused"
		}
	} catch (error) {
		if (
			(error as {$metadata?: {httpStatusCode?: number}}).$metadata
				?.httpStatusCode !== 404
		) {
			throw error
		}
	}
	await input.client.send(
		new PutObjectCommand({
			Bucket: input.config.bucket,
			Key: input.key,
			Body: createReadStream(input.path),
			ContentLength: input.byteSize,
			ContentType: input.mimeType,
			CacheControl: "public, max-age=31536000, immutable",
			Metadata: {sha256: input.sha256},
		}),
	)
	return "uploaded"
}

export async function uploadPhotoCatalogBackup({
	client,
	config,
	path,
	byteSize,
	sha256,
}: {
	client: S3Client
	config: R2Config
	path: string
	byteSize: number
	sha256: string
}): Promise<string> {
	const timestamp = new Date().toISOString().replaceAll(":", "-")
	const key = `catalog/${timestamp}-${sha256.slice(0, 12)}.sqlite`
	await client.send(
		new PutObjectCommand({
			Bucket: config.backupBucket,
			Key: key,
			Body: createReadStream(path),
			ContentLength: byteSize,
			ContentType: "application/vnd.sqlite3",
			Metadata: {sha256},
		}),
	)
	return key
}

export async function deleteR2File(
	client: S3Client,
	config: R2Config,
	key: string,
): Promise<void> {
	await client.send(new DeleteObjectCommand({Bucket: config.bucket, Key: key}))
}
