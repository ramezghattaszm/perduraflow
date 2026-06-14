import { styled } from 'tamagui'
import { P } from './typography'

/**
 * TextLink — inline clickable text (e.g. "Forgot password?", "Sign up"). Extends
 * `P`, so it keeps the `size`/`weight` variants, but adds the link affordances a
 * plain `<P onPress>` lacks: primary color, a real pointer cursor on web, and a
 * subtle hover/press opacity shift. Use this for any tappable text instead of
 * styling a `P` inline (UI §0.1).
 *
 * @example
 * <TextLink size={4} weight="b" onPress={() => router.push('/register')}>Sign up</TextLink>
 */
export const TextLink = styled(P, {
  name: 'TextLink',
  color: '$primary',
  cursor: 'pointer',
  hoverStyle: { opacity: 0.8 },
  pressStyle: { opacity: 0.6 },
})
