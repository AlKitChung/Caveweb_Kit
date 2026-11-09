import { defineConfig } from 'vite';
import { existsSync } from 'fs';
import { delimiter, resolve } from 'path';

// KTX2 texture compression needs KTX-Software's toktx on PATH (see README). A copy unpacked into .tools/ktx is picked up automatically.
const localKtx = resolve(".tools/ktx/bin");
if (existsSync(localKtx) && !process.env.PATH?.includes(localKtx)) {
    process.env.PATH = `${localKtx}${delimiter}${process.env.PATH ?? ""}`;
}

export default defineConfig(async ({ command }) => {
    const { needlePlugins, loadConfig } = await import("@needle-tools/engine/vite");
    const needleConfig = await loadConfig();
    return {
        base: "./",
        plugins: [
            needlePlugins(command, needleConfig, {
                noPoster: true,
                allowHotReload: false,
                // Dev server on the LAN over HTTPS (WebXR and the camera need a secure context) with a QR code to scan.
                remote: { qr: true },
                // Bundle decoders and helper scripts so the deployed game does not depend on third-party CDNs.
                // Fonts stay on Google's CDN, which serves small per-script WOFF2 subsets instead of a ~1 MB TTF.
                makeFilesLocal: { enabled: true, features: "auto", excludeFeatures: ["fonts"] },
                // Compression is license-gated: on GitHub Actions without a NEEDLE_CLOUD_TOKEN secret it would fail the build, so ship uncompressed instead.
                buildPipeline: { enabled: !(process.env.CI && !process.env.NEEDLE_CLOUD_TOKEN) },
            }),
        ],
        server: {
            strictPort: true,
            port: 3000,
            hmr: false,
            // Public HTTPS tunnel for testing the iOS App Clip, which needs a trusted certificate (see README).
            allowedHosts: [".trycloudflare.com"],
        },
        build: {
            outDir: "./dist",
            emptyOutDir: true,
            chunkSizeWarningLimit: 4000,
        }
    }
});
