import { BufferAttribute, BufferGeometry, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { createCrawlingNoiseMaterial } from "../render/CrawlingNoiseMaterial";

export type SurfaceKind = "Floor" | "Rug" | "Desk" | "Chair" | "Bed" | "Armchair" | "Bookshelf" | "Boxes" | "Cabinet" | "Wall";

export const SURFACE_KINDS: readonly SurfaceKind[] = ["Floor", "Rug", "Desk", "Chair", "Bed", "Armchair", "Bookshelf", "Boxes", "Cabinet", "Wall"];

const CELL_SIZE_METERS = 0.026;
const APPEAR_DURATION = 1.4;
const DISSOLVE_DURATION = 0.9;

let discGeometry: BufferGeometry | null = null;

/** Unit quad in the local XZ plane facing +Y, matching the Unity BugPatchQuad mesh. */
function getDiscGeometry(): BufferGeometry {
    if (discGeometry)
        return discGeometry;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    g.computeBoundingSphere();
    discGeometry = g;
    return g;
}

function moveTowards(current: number, target: number, maxDelta: number) {
    return Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta;
}

const smoothStep01 = (x: number) => x * x * (3 - 2 * x);

/** One cluster of "invisible" crawling bugs, drawn by the CrawlingNoise shader on a flat disc. */
export class BugPatch {
    readonly object: Mesh;
    readonly radius: number;
    readonly surface: SurfaceKind;
    readonly center = new Vector3();
    isAlive = true;
    sprayProgress = 0;
    targeted = false;
    onKilled: ((patch: BugPatch) => void) | null = null;

    private readonly material = createCrawlingNoiseMaterial();
    private appear = 0;
    private appearTarget = 1;
    private highlight = 0;
    private dissolve = 0;

    constructor(parent: Object3D, worldPosition: Vector3, worldRotation: Quaternion, radius: number, surface: SurfaceKind, seed: number) {
        this.radius = radius;
        this.surface = surface;
        this.object = new Mesh(getDiscGeometry(), this.material);
        this.object.name = `BugPatch_${surface}_${seed}`;
        this.object.renderOrder = 10;
        this.object.frustumCulled = true;

        parent.updateMatrixWorld();
        this.object.position.copy(worldPosition);
        this.object.quaternion.copy(worldRotation);
        this.object.scale.setScalar(radius * 2);
        parent.attach(this.object);

        this.material.uniforms.uSeed.value = ((seed * 0.6180339) % 1) * 97;
        this.material.uniforms.uCellScale.value = radius / CELL_SIZE_METERS;
        this.revive();
    }

    get normal(): Vector3 {
        return new Vector3(0, 1, 0).applyQuaternion(this.object.getWorldQuaternion(new Quaternion()));
    }

    revive() {
        this.isAlive = true;
        this.appear = 0;
        this.appearTarget = 1;
        this.dissolve = 0;
        this.sprayProgress = 0;
        this.object.visible = true;
        this.push();
    }

    kill() {
        if (!this.isAlive)
            return;
        this.isAlive = false;
        this.targeted = false;
        this.onKilled?.(this);
    }

    setVisible(visible: boolean) {
        this.appearTarget = visible ? 1 : 0;
    }

    update(dt: number) {
        this.object.getWorldPosition(this.center);
        if (!this.object.visible && this.isAlive === false)
            return;

        this.appear = moveTowards(this.appear, this.appearTarget, dt / APPEAR_DURATION);
        this.highlight = moveTowards(this.highlight, this.targeted && this.isAlive ? 1 : 0, dt * 6);

        if (!this.isAlive) {
            this.dissolve = moveTowards(this.dissolve, 1, dt / DISSOLVE_DURATION);
            if (this.dissolve >= 1) {
                this.object.visible = false;
                return;
            }
        }
        this.push();
    }

    dispose() {
        this.object.removeFromParent();
        this.material.dispose();
    }

    private push() {
        const u = this.material.uniforms;
        u.uAppear.value = smoothStep01(this.appear);
        u.uHighlight.value = this.highlight;
        u.uDamage.value = this.isAlive ? this.sprayProgress : 1;
        u.uDissolve.value = this.dissolve;
    }
}
