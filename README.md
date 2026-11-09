# CAVE AR · 張愛玲的跳蚤 — Web

Web build of the CAVE AR game, made with [Needle Engine](https://engine.needle.tools/docs/unity/). Players open a URL on their phone, scan Marker A on the floor, and clear the swarms with the Spray button. No app install is needed.

| Device | How it runs |
| --- | --- |
| Android (ARCore phone, Chrome) | WebXR `immersive-ar` directly in Chrome |
| iPhone / iPad (Safari) | Needle Go App Clip, launched automatically when the player taps Enter / Scan |
| Desktop / no AR | Preview mode: walk the virtual room with mouse + WASD (touch: drag to look, two fingers to walk) |

## Where things live

- `../../Assets/CaveAR/Scenes/CaveGameWeb.unity` — the exported scene (room, furniture, bug spots). It is generated from `CaveGame.unity` by **CaveAR ▸ Build Web Scene** (`Assets/CaveAR/Scripts/Editor/BuildWebScene.cs`); re-run it after changing the original scene; it rebuilds the scene and exports `assets/CaveGameWeb.glb`.
- `src/scripts/` — game logic (TypeScript port of the Unity C# scripts): `GameManager`, `game/CaveAligner` (marker + tap-to-place alignment), `game/BugSpawner`, `game/SprayController`, materials and audio.
- `src/ui/`, `index.html`, `src/styles/cave.css` — the HTML overlay UI (title, story, scan, HUD, end, pause, operator panel).
- `public/markers/MARKER_A.png` — the tracked image. Print `public/markers/MARKER_A_A4_26cm.pdf` on A4 at 100% / "Actual size"; the image must measure **26 cm wide** (`markerWidthMeters` on `GameManager`).

## Develop

```bash
npm install
npm run dev        # https://<your-LAN-ip>:3000 + QR code in the terminal
npm test           # unit tests for the alignment / spray math
npm run typecheck
```

Phones must be on the same Wi‑Fi. The dev certificate is self-signed: tap "Advanced → proceed" once. For desktop-only work you can use plain http instead: `NEEDLE_REMOTE=0 npm run dev` → http://localhost:3000.

## Build and deploy

```bash
npm run build      # production build into dist/
npm run preview    # serve dist/ locally to check the build
```

The site is hosted on **GitHub Pages**. `.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`, and the game is served at `https://<user>.github.io/<repo>/`.

One-time setup: in the GitHub repo open **Settings → Pages** and set **Source** to **GitHub Actions**. Progress is shown under the **Actions** tab.

Texture and mesh compression (Draco, KTX2, progressive LODs) is license-gated. To turn it on in CI, add a `NEEDLE_CLOUD_TOKEN` repository secret (an `nc_*` token from https://cloud.needle.tools/team); without it the build still works, the files are just larger. WebXR **requires HTTPS**, which GitHub Pages provides. Put the deployed URL in a QR code for visitors.

KTX2 texture compression needs [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) ≥ 4.3 (`toktx`). Either install it system-wide, or unpack the macOS `.pkg` into `.tools/ktx/{bin,lib}` (git-ignored) — `vite.config.js` picks that up automatically. Without it the build still works, but textures stay JPEG/PNG and use more GPU memory on phones.

## Testing on phones

**Android**: Chrome on an ARCore-supported phone. Tap 進入房間 → 開始掃描; Chrome asks for camera permission and starts AR.
Marker tracking uses the WebXR image-tracking API, which Chrome still keeps behind a flag: open `chrome://flags/#webxr-incubations`, enable it, restart Chrome. Without the flag the game automatically falls back to **tap-to-place**: point at the floor where Marker A lies and tap 放置房間.

**iOS**: open the URL in Safari and tap Enter. iOS has no WebXR in Safari, so Needle launches the **Needle Go App Clip** (a small native viewer, nothing to install from the App Store), which reloads the same URL with full WebXR incl. image tracking. The game resumes directly at the scan step.

**Alignment check** (both platforms): open the operator panel (⚙ on the title screen, F1, or a three-finger triple tap during play), turn on 洞穴線框 to see the cave mesh, and use Yaw / Offset nudges if the room is rotated or shifted relative to the real space.

## Performance notes

- First load ≈ 1.6 MB gzipped; physics (Rapier), post-processing and MaterialX code are not used and not loaded.
- Pixel ratio capped at 2, no shadows, no post-processing, GPU instancing off (avoids iOS issues), ~20–40 draw calls in play.
- Rendering pauses when the tab is hidden; the round timer pauses while AR tracking is lost.
