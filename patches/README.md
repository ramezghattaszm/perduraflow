# Patches

Applied via Bun's `patchedDependencies` in the root `package.json`.

- **`solito@5.0.0.patch`** — replaces `accessibilityRole: 'link'` with `role: 'link'`
  in Solito's link components. Required for React Native 0.81+ / react-native-web 0.21,
  where `accessibilityRole` is deprecated. **Active.**

- **`@tamagui-portal@2.0.0-rc.16.patch.disabled`** — disables native portal creation to
  avoid a "property is not writable" crash on RN 0.81+ with `@tamagui/portal`. **Disabled**
  (not referenced in `patchedDependencies`) because the current stack does not hit the crash.
  If native portals (toasts/modals) crash on a future RN/Tamagui bump, rename to
  `.patch` and add `"@tamagui/portal@2.0.0-rc.16": "patches/@tamagui-portal@2.0.0-rc.16.patch"`
  to `patchedDependencies`.
