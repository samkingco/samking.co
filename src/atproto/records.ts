import type {ComAtprotoRepoListRecords} from "@atcute/atproto"
import {encode} from "@atcute/cbor"
import {
	toString as cidToString,
	CODEC_DCBOR,
	create as createCid,
} from "@atcute/cid"
import {parse, resourceUriString} from "@atcute/lexicons/validations"

export type RemoteRecord = ComAtprotoRepoListRecords.Record

export async function createPlannedRecord<
	T extends RemoteRecord["value"],
>(input: {
	did: string
	collection: string
	rkey: string
	label: string
	record: T
}) {
	return {
		collection: input.collection,
		rkey: input.rkey,
		uri: parse(
			resourceUriString(),
			`at://${input.did}/${input.collection}/${input.rkey}`,
		),
		cid: cidToString(await createCid(CODEC_DCBOR, encode(input.record))),
		label: input.label,
		record: input.record,
	}
}

export function compareRecords(
	desired: PlannedRecord[],
	remote: RemoteRecord[],
) {
	const byUri = new Map(remote.map((record) => [record.uri, record]))
	const desiredUris = new Set<string>()
	const creates: PlannedRecord[] = []
	const updates: PlannedRecord[] = []
	const unchanged: PlannedRecord[] = []
	for (const record of desired) {
		if (desiredUris.has(record.uri)) {
			throw new Error(`Duplicate record URI: ${record.uri}`)
		}
		desiredUris.add(record.uri)
		const existing = byUri.get(record.uri)
		if (!existing) {
			creates.push(record)
		} else if (existing.cid === record.cid) {
			unchanged.push(record)
		} else {
			updates.push(record)
		}
	}
	return {
		creates,
		updates,
		unchanged,
		unmatched: remote.filter((record) => !desiredUris.has(record.uri)),
	}
}

export type PlannedRecord = Awaited<ReturnType<typeof createPlannedRecord>>
export type RecordPlan = ReturnType<typeof compareRecords>
