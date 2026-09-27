import {ComAtprotoRepoPutRecord} from "@atcute/atproto"
import {Client, ok} from "@atcute/client"
import {didString, parse} from "@atcute/lexicons/validations"
import {PasswordSession} from "@atcute/password-session"
import {siteConfig} from "../site.config.ts"
import type {planBluesky} from "./plan.ts"
import type {PlannedRecord} from "./records.ts"

export function requireBlueskyPublishing(): void {
	if (!siteConfig.atproto.bluesky.publishingEnabled) {
		throw new Error("Bluesky publishing is disabled in site.config.ts.")
	}
}

export async function createBlueskyClient(did: string, endpoint: string) {
	requireBlueskyPublishing()
	const password = process.env.ATPROTO_APP_PASSWORD
	if (!password) {
		throw new Error("Set ATPROTO_APP_PASSWORD in .env before publishing.")
	}
	let session: PasswordSession
	try {
		session = await PasswordSession.login(
			{service: endpoint, identifier: did, password},
			{
				fetch: (input, init) =>
					fetch(input, {
						...init,
						redirect: "error",
						signal: AbortSignal.timeout(10_000),
					}),
			},
		)
	} catch (cause) {
		throw new Error(
			"AT Protocol login failed. Check ATPROTO_APP_PASSWORD and the PDS connection.",
			{cause},
		)
	}
	if (session.did !== did) {
		throw new Error(
			"The authenticated DID does not match the configured account.",
		)
	}
	return new Client({handler: session})
}

export async function publishBluesky(
	result: Awaited<ReturnType<typeof planBluesky>>,
	onPublished: (record: PlannedRecord) => void,
): Promise<number> {
	requireBlueskyPublishing()
	const records = [...result.plan.creates, ...result.plan.updates]
	if (records.length === 0) {
		return 0
	}
	const client = await createBlueskyClient(result.did, result.endpoint)
	let completed = 0
	for (const record of records) {
		try {
			await ok(
				client.call(ComAtprotoRepoPutRecord, {
					input: {
						repo: parse(didString(), result.did),
						collection: "app.bsky.feed.post",
						rkey: record.rkey,
						record: record.record,
						validate: true,
					},
				}),
			)
		} catch (cause) {
			throw new Error(
				`Publishing stopped after ${completed} of ${records.length} confirmed writes. Could not confirm ${record.uri}. Run the plan again before retrying.`,
				{cause},
			)
		}
		completed++
		onPublished(record)
	}
	return completed
}
