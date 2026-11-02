import type {DatabaseSync, SQLInputValue} from "node:sqlite"
import {pushSchema} from "drizzle-kit/payload/sqlite"
import * as schema from "./database-schema.ts"

/** Applies the Drizzle schema to a catalog, as `pnpm photos:db:push` does. */
export async function pushPhotoSchema(client: DatabaseSync): Promise<void> {
	const {apply} = await pushSchema(schema, {
		query: async <T>(sql: string, params: SQLInputValue[] = []) =>
			client.prepare(sql).all(...params) as T[],
		run: async (sql) => {
			client.exec(sql)
		},
		batch: async (statements) => {
			for (const statement of statements) {
				client.exec(statement)
			}
		},
	})
	await apply()
}
