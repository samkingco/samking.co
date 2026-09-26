import {createReadStream} from "node:fs"
import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import * as v from "valibot"
import {type R2Config, R2ConfigSchema} from "./schema.ts"

export const PHOTO_CDN_URL = "https://cdn.samking.co"

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
}): Promise<void> {
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
