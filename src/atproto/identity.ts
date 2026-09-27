import {getPdsEndpoint, isAtprotoDid} from "@atcute/identity"
import {
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	XrpcHandleResolver,
} from "@atcute/identity-resolver"
import {handleString, parse} from "@atcute/lexicons/validations"

const handles = new XrpcHandleResolver({serviceUrl: "https://bsky.social"})
const documents = new CompositeDidDocumentResolver({
	methods: {
		plc: new PlcDidDocumentResolver(),
		web: new WebDidDocumentResolver(),
	},
})

export async function resolveHandle(handle: string): Promise<string> {
	return handles.resolve(parse(handleString(), handle.toLowerCase()), {
		signal: AbortSignal.timeout(5_000),
	})
}

export async function resolvePds(did: string): Promise<string> {
	if (!isAtprotoDid(did)) {
		throw new Error(`Invalid AT Protocol DID: ${did}`)
	}
	const document = await documents.resolve(did, {
		signal: AbortSignal.timeout(10_000),
	})
	if (document.id !== did) {
		throw new Error(`DID document does not match ${did}`)
	}
	const endpoint = getPdsEndpoint(document)
	if (!endpoint || new URL(endpoint).protocol !== "https:") {
		throw new Error("DID document has no HTTPS AT Protocol PDS")
	}
	return endpoint
}
