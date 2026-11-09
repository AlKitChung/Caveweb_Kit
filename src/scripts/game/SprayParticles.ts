import { BufferAttribute, BufferGeometry, Points, Quaternion, Vector2, Vector3, WebGLRenderer } from "three";
import { createSprayMaterial } from "../render/Materials";

const MAX_PARTICLES = 300;
const RATE = 140;
const CONE_RADIANS = 8 * Math.PI / 180;
const GRAVITY = 9.81 * 0.08;
const DRAG = 2.5;

/**
 * Pooled world-space aerosol mist (port of the Unity SprayMist particle system).
 * A single draw call; all buffers are preallocated so spraying never allocates.
 */
export class SprayParticles {
    readonly points: Points;
    private readonly geometry = new BufferGeometry();
    private readonly material = createSprayMaterial();
    private readonly positions = new Float32Array(MAX_PARTICLES * 3);
    private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
    private readonly sizes = new Float32Array(MAX_PARTICLES);
    private readonly alphas = new Float32Array(MAX_PARTICLES);
    private readonly startSizes = new Float32Array(MAX_PARTICLES);
    private readonly ages = new Float32Array(MAX_PARTICLES);
    private readonly lifetimes = new Float32Array(MAX_PARTICLES);
    private alive = 0;
    private emitAccumulator = 0;
    private readonly tmpDir = new Vector3();
    private readonly tmpQuat = new Quaternion();
    private readonly tmpSize = new Vector2();
    private readonly forward = new Vector3(0, 0, 1);

    emitting = false;
    readonly origin = new Vector3();
    readonly direction = new Vector3(0, 0, 1);

    constructor() {
        this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
        this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alphas, 1));
        this.geometry.setDrawRange(0, 0);
        this.points = new Points(this.geometry, this.material);
        this.points.name = "SprayMist";
        this.points.frustumCulled = false;
        this.points.renderOrder = 20;
    }

    update(dt: number, renderer: WebGLRenderer) {
        this.material.uniforms.uViewportHeight.value = renderer.getDrawingBufferSize(this.tmpSize).y;

        if (this.emitting) {
            this.emitAccumulator += dt * RATE;
            while (this.emitAccumulator >= 1) {
                this.emitAccumulator -= 1;
                this.emit();
            }
        }
        else {
            this.emitAccumulator = 0;
        }

        const dragFactor = Math.max(0, 1 - DRAG * dt);
        let i = 0;
        while (i < this.alive) {
            this.ages[i] += dt;
            const life = this.ages[i] / this.lifetimes[i];
            if (life >= 1) {
                this.swapRemove(i);
                continue;
            }
            const i3 = i * 3;
            this.velocities[i3] *= dragFactor;
            this.velocities[i3 + 1] = this.velocities[i3 + 1] * dragFactor - GRAVITY * dt;
            this.velocities[i3 + 2] *= dragFactor;
            this.positions[i3] += this.velocities[i3] * dt;
            this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
            this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
            this.sizes[i] = this.startSizes[i] * (0.4 + 1.8 * life);
            this.alphas[i] = life < 0.1 ? (life / 0.1) * 0.55 : 0.55 * (1 - (life - 0.1) / 0.9);
            i++;
        }

        this.geometry.setDrawRange(0, this.alive);
        if (this.alive > 0) {
            (this.geometry.attributes.position as BufferAttribute).needsUpdate = true;
            (this.geometry.attributes.aSize as BufferAttribute).needsUpdate = true;
            (this.geometry.attributes.aAlpha as BufferAttribute).needsUpdate = true;
        }
        this.points.visible = this.alive > 0;
    }

    clear() {
        this.alive = 0;
        this.geometry.setDrawRange(0, 0);
        this.points.visible = false;
    }

    private emit() {
        if (this.alive >= MAX_PARTICLES)
            return;
        const i = this.alive++;
        const i3 = i * 3;
        // Random direction inside the cone around `direction`.
        const angle = Math.random() * CONE_RADIANS;
        const spin = Math.random() * Math.PI * 2;
        this.tmpDir.set(Math.sin(angle) * Math.cos(spin), Math.sin(angle) * Math.sin(spin), Math.cos(angle));
        this.tmpQuat.setFromUnitVectors(this.forward, this.direction);
        this.tmpDir.applyQuaternion(this.tmpQuat);
        const speed = 1.8 + Math.random() * 1.2;

        this.positions[i3] = this.origin.x;
        this.positions[i3 + 1] = this.origin.y;
        this.positions[i3 + 2] = this.origin.z;
        this.velocities[i3] = this.tmpDir.x * speed;
        this.velocities[i3 + 1] = this.tmpDir.y * speed;
        this.velocities[i3 + 2] = this.tmpDir.z * speed;
        this.startSizes[i] = 0.025 + Math.random() * 0.045;
        this.sizes[i] = this.startSizes[i] * 0.4;
        this.alphas[i] = 0;
        this.ages[i] = 0;
        this.lifetimes[i] = 0.45 + Math.random() * 0.35;
    }

    private swapRemove(i: number) {
        const last = --this.alive;
        if (i === last)
            return;
        const i3 = i * 3, l3 = last * 3;
        for (let k = 0; k < 3; k++) {
            this.positions[i3 + k] = this.positions[l3 + k];
            this.velocities[i3 + k] = this.velocities[l3 + k];
        }
        this.sizes[i] = this.sizes[last];
        this.alphas[i] = this.alphas[last];
        this.startSizes[i] = this.startSizes[last];
        this.ages[i] = this.ages[last];
        this.lifetimes[i] = this.lifetimes[last];
    }
}
