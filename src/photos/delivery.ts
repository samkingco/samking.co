import {siteConfig} from "../site.config.ts"
import type {PhotoDerivativeKind} from "./schema.ts"

export type PlannedDerivative = {
	kind: PhotoDerivativeKind
	objectKey: string
	r2Key: string
}

export function websiteDerivativePlan(
	photoId: string,
	exportSha256: string,
): PlannedDerivative[] {
	return siteConfig.photos.r2Derivatives.map(({kind, path}) => ({
		kind,
		objectKey: `${photoId}/${exportSha256}/${path}`,
		r2Key: `photos/${photoId}/${exportSha256}/${path}`,
	}))
}
