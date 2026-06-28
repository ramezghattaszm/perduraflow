# Perdura — temp logo (monogram P)

Accent: **deep teal `#0F766E`** · dark `#0B0E12` · light `#F6F8F8`.
Swap the accent by editing the color in any `svg/*.svg` and re-rendering — it's a single value.

## Files
**`/web`** — favicon.ico (16/32/48 multi-res), favicon-16/32/48, apple-touch-icon (180), icon-192, icon-512, maskable-512, icon-512-dark.
**`/native`** — icon.png (1024, no alpha), adaptive-icon-foreground.png (1024), splash-icon.png, favicon.png (48), icon-dark.png.
**`/svg`** — editable sources (tile + transparent marks, light/dark/teal, adaptive foreground).
**PREVIEW.png** — light/dark + small sizes.

## Web (Next.js / any)
Drop `/web/*` into `public/`. In `<head>`:
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```
`site.webmanifest` icons:
```json
{ "icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]}
```

## Native (Expo app.json)
```json
{ "expo": {
  "icon": "./assets/icon.png",
  "android": { "adaptiveIcon": {
    "foregroundImage": "./assets/adaptive-icon-foreground.png",
    "backgroundColor": "#0F766E" } },
  "web": { "favicon": "./assets/favicon.png" },
  "splash": { "image": "./assets/splash-icon.png", "backgroundColor": "#0F766E", "resizeMode": "contain" }
}}
```
iOS uses `icon.png` (full-bleed, no transparency — already correct). Android uses the adaptive foreground over the teal background.

> Temp mark for internal/demo use. Not a final brand asset.
