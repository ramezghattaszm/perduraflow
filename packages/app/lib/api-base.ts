import { Platform } from 'react-native'

const FALLBACK = 'http://localhost:3000/api/v1'

const configured =
  process.env.EXPO_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? FALLBACK

/**
 * Resolved API base URL, shared by the axios client and the refresh path.
 *
 * The Android emulator runs in its own VM and cannot reach the host machine via
 * `localhost` / `127.0.0.1` — those resolve to the emulator itself. The host's
 * loopback is exposed at the special alias `10.0.2.2`, so on Android we rewrite a
 * localhost host to it. Web (localhost is correct) and iOS simulator (shares the
 * host network) are left untouched, as is any explicit non-localhost env URL.
 */
export const API_BASE_URL =
  Platform.OS === 'android'
    ? configured.replace(/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/, '//10.0.2.2$2')
    : configured
