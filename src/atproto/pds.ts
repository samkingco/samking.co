import {ComAtprotoRepoListRecords} from "@atcute/atproto"
import {Client, ok, simpleFetchHandler} from "@atcute/client"
import type {Did, Nsid} from "@atcute/lexicons/syntax"
import {didString, nsidString, parse} from "@atcute/lexicons/validations"
import {resolvePds} from "./identity.ts"
import type {RemoteRecord} from "./records.ts"

export async function readRemoteRecords(
	did: string,
	collections: readonly string[],
): Promise<{endpoint: string; records: RemoteRecord[]}> {
	const endpoint = await resolvePds(did)
	const client = new Client({handler: simpleFetchHandler({service: endpoint})})
	const repo = parse(didString(), did)
	const records = await Promise.all(
		collections.map((collection) =>
			readCollection(client, repo, parse(nsidString(), collection)),
		),
	)
	return {endpoint, records: records.flat()}
}

async function readCollection(
	client: Client,
	did: Did,
	collection: Nsid,
): Promise<RemoteRecord[]> {
	const records: RemoteRecord[] = []
	const cursors = new Set<string>()
	let cursor: string | undefined
	do {
		const page = await ok(
			client.call(ComAtprotoRepoListRecords, {
				params: {repo: did, collection, cursor, limit: 100},
				signal: AbortSignal.timeout(10_000),
			}),
		)
		const prefix = `at://${did}/${collection}/`
		if (page.records.some((record) => !record.uri.startsWith(prefix))) {
			throw new Error(`PDS returned records outside ${collection} for ${did}`)
		}
		records.push(...page.records)
		cursor = page.cursor
		if (cursor && cursors.has(cursor)) {
			throw new Error(`Repeated cursor while reading ${collection}`)
		}
		cursors.add(cursor ?? "")
	} while (cursor)
	return records
}
