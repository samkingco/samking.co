import {defineConfig} from "drizzle-kit"

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/photos/database-schema.ts",
	out: "./drizzle/photos",
	dbCredentials: {
		url: process.env.PHOTO_DATABASE_PATH ?? "photos/catalog.sqlite",
	},
})
