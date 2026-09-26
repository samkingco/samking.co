import {mkdir, mkdtemp, rm, stat} from "node:fs/promises"
import {join} from "node:path"
import {backup} from "node:sqlite"
import type {S3Client} from "@aws-sdk/client-s3"
import type {PhotoDatabase} from "./database.ts"
import {hashFile} from "./file-hash.ts"
import {uploadPhotoCatalogBackup} from "./r2.ts"
import type {R2Config} from "./schema.ts"

export async function backupPhotoDatabase(
	database: PhotoDatabase,
	client: S3Client,
	config: R2Config,
): Promise<string> {
	await mkdir("photos", {recursive: true})
	const directory = await mkdtemp(join("photos", "backup-"))
	const path = join(directory, "catalog.sqlite")
	try {
		await backup(database.$client, path)
		const [sha256, {size}] = await Promise.all([hashFile(path), stat(path)])
		return await uploadPhotoCatalogBackup({
			client,
			config,
			path,
			byteSize: size,
			sha256,
		})
	} finally {
		await rm(directory, {recursive: true, force: true})
	}
}
