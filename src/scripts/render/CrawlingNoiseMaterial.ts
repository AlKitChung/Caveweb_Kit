import { Color, DoubleSide, IUniform, ShaderMaterial, SRGBColorSpace, Vector4 } from "three";

/** Shared across every patch so a single write per frame animates all of them. */
export const crawlTime: IUniform<number> = { value: 0 };

const srgb = (r: number, g: number, b: number) => new Color().setRGB(r, g, b, SRGBColorSpace);

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Port of Assets/CaveAR/Shaders/CrawlingNoise.shader.
const fragmentShader = /* glsl */`
uniform vec3 uInkColor;
uniform vec4 uHaloColor;
uniform vec3 uAccentColor;
uniform float uCellScale;
uniform float uSpeckRadius;
uniform float uDensity;
uniform float uSpeed;
uniform float uAppear;
uniform float uHighlight;
uniform float uDamage;
uniform float uDissolve;
uniform float uSeed;
uniform float uTime;
varying vec2 vUv;

// HLSL smoothstep accepts edge0 > edge1; GLSL leaves that undefined, so use an order-safe version.
float ss(float a, float b, float x) {
    float t = clamp((x - a) / (b - a), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n + 17.17));
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p = p * 2.03 + 11.7;
        a *= 0.5;
    }
    return v;
}

// One layer of crawling specks: each cell owns one bug that wanders around its cell centre.
vec2 bugLayer(vec2 uv, float scale, float layerSeed, float t, float agitation, float density, float scatter) {
    vec2 origin = vec2(layerSeed * 7.31 + uSeed);
    vec2 p = uv * scale + origin;
    vec2 cell = floor(p);
    float body = 0.0;
    float halo = 0.0;

    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec2 c = cell + vec2(float(x), float(y));
        vec2 h = hash22(c + layerSeed);
        float alive = step(h.x, density);
        alive *= step(uDissolve, hash21(c * 1.37 + 3.1));
        if (alive < 0.5) continue;

        float speed = uSpeed * (0.6 + h.y) * (1.0 + agitation * 3.0);
        float phase = t * speed * 6.2831 + h.x * 40.0;
        vec2 wander = vec2(sin(phase + h.y * 6.2831), cos(phase * 0.83 + h.x * 9.0));
        vec2 vel = vec2(cos(phase + h.y * 6.2831), -0.83 * sin(phase * 0.83 + h.x * 9.0));
        vec2 jitter = 0.05 * vec2(sin(t * (31.0 + h.x * 17.0)), cos(t * (27.0 + h.y * 13.0))) * (0.4 + agitation);

        vec2 centre = c + 0.5 + wander * (0.34 + 0.12 * agitation) + jitter;
        vec2 away = c + 0.5 - origin;
        centre += away / max(length(away), 1e-4) * scatter * scale * 0.2;

        vec2 d = p - centre;
        vec2 dir = normalize(vel + 1e-4);
        float along = dot(d, dir);
        float across = dot(d, vec2(-dir.y, dir.x));
        float r = uSpeckRadius * (0.65 + 0.7 * h.y);
        float dist = length(vec2(along / 1.7, across));

        body = max(body, ss(r, r * 0.55, dist));
        halo = max(halo, ss(r * 2.1, r, dist));
    }
    return vec2(body, halo);
}

void main() {
    vec2 uv = vUv;
    float r = length(uv);
    float t = uTime;

    float edge = 0.62 + 0.3 * fbm(uv * 2.2 + uSeed + t * 0.04);
    float mask = ss(edge, edge - 0.45, r);
    float density = uDensity * mask * (1.0 - 0.6 * uDissolve);

    float agitation = clamp(uDamage * 1.2 + uDissolve, 0.0, 1.0);
    float scatter = uDissolve;

    vec2 l0 = bugLayer(uv, uCellScale, 0.0, t, agitation, density, scatter);
    vec2 l1 = bugLayer(uv, uCellScale * 1.7, 1.0, t * 1.15, agitation, density * 0.8, scatter);
    vec2 l2 = bugLayer(uv, uCellScale * 0.62, 2.0, t * 0.8, agitation, density * 0.45, scatter);

    float body = max(l0.x, max(l1.x * 0.85, l2.x));
    float halo = max(l0.y, max(l1.y, l2.y));

    float grain = step(0.86, valueNoise(uv * 38.0 + vec2(t * 2.3, -t * 1.7) + uSeed)) * mask * 0.12;

    vec3 color = uInkColor;
    float alpha = clamp(body + grain, 0.0, 1.0);
    float haloA = halo * (1.0 - body) * uHaloColor.a;
    color = mix(uHaloColor.rgb, color, clamp(alpha / max(alpha + haloA, 1e-4), 0.0, 1.0));
    alpha = clamp(alpha + haloA, 0.0, 1.0);

    // Targeting ring with a dashed rim and a progress arc for the 2 s hold.
    float angle = atan(uv.x, uv.y) / 6.2831 + 0.5;
    float ringDist = abs(r - 0.94);
    float ring = ss(0.022, 0.006, ringDist);
    float dashes = step(0.45, fract(angle * 36.0 + t * 0.35));
    float progressArc = step(angle, uDamage) * ss(0.045, 0.02, ringDist);
    float ringA = uHighlight * max(ring * dashes * 0.55, progressArc);
    color = mix(color, uAccentColor, clamp(ringA * 1.5, 0.0, 1.0));
    alpha = max(alpha, ringA);

    alpha *= uAppear * (1.0 - ss(0.7, 1.0, uDissolve));
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
}
`;

const ink = srgb(0.07, 0.055, 0.045);
const halo = srgb(0.95, 0.92, 0.86);
const accent = srgb(0.698, 0.227, 0.18);

export type CrawlingNoiseUniforms = {
    uAppear: IUniform<number>;
    uHighlight: IUniform<number>;
    uDamage: IUniform<number>;
    uDissolve: IUniform<number>;
    uSeed: IUniform<number>;
    uCellScale: IUniform<number>;
};

/** One material per patch (they share the compiled program), so each patch keeps its own animation state. */
export function createCrawlingNoiseMaterial(): ShaderMaterial & { uniforms: CrawlingNoiseUniforms } {
    const material = new ShaderMaterial({
        name: "CrawlingNoise",
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
        uniforms: {
            uInkColor: { value: ink },
            uHaloColor: { value: new Vector4(halo.r, halo.g, halo.b, 0.22) },
            uAccentColor: { value: accent },
            uCellScale: { value: 14 },
            uSpeckRadius: { value: 0.19 },
            uDensity: { value: 0.62 },
            uSpeed: { value: 0.22 },
            uAppear: { value: 0 },
            uHighlight: { value: 0 },
            uDamage: { value: 0 },
            uDissolve: { value: 0 },
            uSeed: { value: 0 },
            uTime: crawlTime,
        },
    });
    return material as ShaderMaterial & { uniforms: CrawlingNoiseUniforms };
}
