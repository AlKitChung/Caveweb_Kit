import { Color, DoubleSide, LineBasicMaterial, Material, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, ShaderMaterial, SRGBColorSpace } from "three";

/** Writes depth only, so the real cave walls (seen through the camera) hide virtual content behind them. Port of DepthOccluder.shader. */
export const occluderMaterial: Material = new MeshBasicMaterial({
    name: "CaveOccluder",
    colorWrite: false,
    depthWrite: true,
    side: DoubleSide,
});

/** Visible cave surface for the non-AR preview, where there is no camera image of the real room. */
export const previewCaveMaterial: Material = new MeshStandardMaterial({
    name: "CavePreview",
    color: new Color().setRGB(0.62, 0.6, 0.57, SRGBColorSpace),
    roughness: 0.95,
    side: DoubleSide,
});

/** Always-on-top cyan lines for checking alignment. Port of the CaveWire material (UnlitTransparent, ZTest Always). */
export const wireMaterial: Material = new LineBasicMaterial({
    name: "CaveWire",
    color: new Color().setRGB(0.3, 0.95, 1, SRGBColorSpace),
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
});

/** Soft radial blob under furniture. Port of the ContactShadow material without needing a texture. */
export const contactShadowMaterial: Material = new ShaderMaterial({
    name: "ContactShadow",
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    blending: NormalBlending,
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * 0.6;
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
});

/** Point sprites for the aerosol mist. Port of SprayParticle.shader with the SoftDot texture computed in the shader. */
export function createSprayMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        name: "SprayMist",
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        uniforms: {
            uViewportHeight: { value: 1000 },
        },
        vertexShader: /* glsl */`
            attribute float aSize;
            attribute float aAlpha;
            uniform float uViewportHeight;
            varying float vAlpha;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSize * uViewportHeight * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.02);
                vAlpha = aAlpha;
            }`,
        fragmentShader: /* glsl */`
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.8) * vAlpha * 0.5;
                if (a < 0.004) discard;
                gl_FragColor = vec4(0.95, 0.97, 1.0, a);
            }`,
    });
}
