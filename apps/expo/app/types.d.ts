import { config } from '@perduraflow/config'

export type Conf = typeof config

declare module '@perduraflow/ui' {
  interface TamaguiCustomConfig extends Conf {}
}
