import { SetMetadata } from '@nestjs/common'

/** Metadata key marking a handler as exempt from the response envelope. */
export const SKIP_TRANSFORM = 'skipTransform'
/** Opt a handler out of the {statusCode, data} envelope (e.g. file streams). */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM, true)
