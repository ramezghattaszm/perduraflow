// Web shim for `react-native/Libraries/Utilities/codegenNativeComponent`.
//
// react-native-web has no `Libraries/Utilities/codegenNativeComponent`, but native-only deps that
// Storybook transitively pulls (e.g. react-native-safe-area-context's NativeSafeAreaView spec) import
// it. Without this shim, the `react-native` → `react-native-web` alias rewrites that deep path to a
// file that doesn't exist and the Vite build fails. codegen specs are never rendered on web (the web
// build of those libs uses a JS fallback), so a passthrough that returns the view name is sufficient.
export default function codegenNativeComponent(name) {
  return name
}
