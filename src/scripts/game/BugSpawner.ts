import { Mesh, Quaternion, Raycaster, Vector3 } from "three";
import { ROOM_FORWARD, UP } from "../logic/AlignmentMath";
import { SeededRandom } from "../logic/Random";
import { BugPatch, SurfaceKind } from "./BugPatch";
import { Room } from "./Room";

const DEG = Math.PI / 180;

/** Scatters bug patches over furniture spots, the cave floor and the cave walls, and optionally regrows them. Port of BugSpawner.cs. */
export class BugSpawner {
    furniturePatches = 11;
    floorPatches = 7;
    wallPatches = 7;
    floorHalfExtents = { x: 3.2, z: 2.7 };
    floorRadiusRange = [0.32, 0.55] as const;
    wallRadiusRange = [0.28, 0.45] as const;
    wallHeightRange = [0.45, 1.75] as const;
    /** Wall rays are cast within this many degrees of the end wall (room +Z), avoiding the open entrance. */
    wallArcDegrees = 150;
    minSpacing = 0.85;
    surfaceLift = 0.004;
    regrowth = false;
    regrowDelayRange = [18, 30] as const;
    maxRegrowths = 4;

    readonly patches: BugPatch[] = [];
    regrowths = 0;
    onPatchKilled: ((p: BugPatch) => void) | null = null;
    onPatchRegrew: ((p: BugPatch) => void) | null = null;

    private pendingRegrowths: { patch: BugPatch, at: number }[] = [];
    private time = 0;
    private readonly raycaster = new Raycaster();

    constructor(private readonly room: Room) { }

    get total() {
        return this.patches.length;
    }

    get alive() {
        let n = 0;
        for (const p of this.patches)
            if (p.isAlive)
                n++;
        return n;
    }

    spawn(seed: number) {
        this.clear();
        const random = new SeededRandom(seed);
        const placed: Vector3[] = [];
        this.room.worldRoot.updateMatrixWorld(true);
        this.spawnOnFurniture(random, placed);
        this.spawnOnFloor(random, placed);
        this.spawnOnWalls(random, placed);
        console.log(`[CaveAR] Spawned ${this.patches.length} patches (seed ${seed})`);
    }

    clear() {
        this.cancelRegrowth();
        this.regrowths = 0;
        for (const p of this.patches)
            p.dispose();
        this.patches.length = 0;
    }

    setPatchesVisible(visible: boolean) {
        for (const p of this.patches)
            p.setVisible(visible);
    }

    cancelRegrowth() {
        this.pendingRegrowths.length = 0;
    }

    update(dt: number) {
        this.time += dt;
        for (const p of this.patches)
            p.update(dt);

        for (let i = this.pendingRegrowths.length - 1; i >= 0; i--) {
            const pending = this.pendingRegrowths[i];
            if (this.time < pending.at)
                continue;
            this.pendingRegrowths.splice(i, 1);
            if (pending.patch.isAlive || this.alive === 0)
                continue;
            this.regrowths++;
            pending.patch.revive();
            this.onPatchRegrew?.(pending.patch);
        }
    }

    private spawnOnFurniture(random: SeededRandom, placed: Vector3[]) {
        const spots = random.shuffle([...this.room.spots]);
        const pos = new Vector3();
        const spotRotation = new Quaternion();
        const spotUp = new Vector3();
        let count = 0;
        for (const spot of spots) {
            if (count >= this.furniturePatches)
                break;
            spot.object.getWorldQuaternion(spotRotation);
            spotUp.copy(UP).applyQuaternion(spotRotation);
            spot.object.getWorldPosition(pos).addScaledVector(spotUp, this.surfaceLift);
            if (!farEnough(pos, placed, this.minSpacing * 0.6))
                continue;

            const spin = new Quaternion().setFromAxisAngle(spotUp, random.range(0, 360) * DEG);
            const radius = spot.radius * random.range(0.85, 1.1);
            this.addPatch(pos, spin.multiply(spotRotation), radius, spot.surface, random, placed);
            count++;
        }
    }

    private spawnOnFloor(random: SeededRandom, placed: Vector3[]) {
        const root = this.room.worldRoot;
        const rootUp = UP.clone().applyQuaternion(root.getWorldQuaternion(new Quaternion()));
        const down = rootUp.clone().negate();
        const rootRotation = root.getWorldQuaternion(new Quaternion());
        let count = 0;
        for (let attempt = 0; attempt < 200 && count < this.floorPatches; attempt++) {
            const local = new Vector3(random.range(-this.floorHalfExtents.x, this.floorHalfExtents.x), 1.6,
                random.range(-this.floorHalfExtents.z, this.floorHalfExtents.z));
            const origin = root.localToWorld(local);
            const hit = this.raycastCave(origin, down, 3);
            if (!hit)
                continue;

            const radius = random.range(this.floorRadiusRange[0], this.floorRadiusRange[1]);
            const pos = hit.point.addScaledVector(rootUp, this.surfaceLift);
            if (!farEnough(pos, placed, this.minSpacing + radius))
                continue;

            const rotation = new Quaternion().setFromAxisAngle(rootUp, random.range(0, 360) * DEG).multiply(rootRotation);
            this.addPatch(pos, rotation, radius, "Floor", random, placed);
            count++;
        }
    }

    private spawnOnWalls(random: SeededRandom, placed: Vector3[]) {
        const root = this.room.worldRoot;
        const rootRotation = root.getWorldQuaternion(new Quaternion());
        const rootUp = UP.clone().applyQuaternion(rootRotation);
        let count = 0;
        for (let attempt = 0; attempt < 200 && count < this.wallPatches; attempt++) {
            const yaw = random.range(-this.wallArcDegrees, this.wallArcDegrees);
            const height = random.range(this.wallHeightRange[0], this.wallHeightRange[1]);
            const origin = root.localToWorld(new Vector3(0, height, 0));
            const dir = ROOM_FORWARD.clone()
                .applyAxisAngle(UP, yaw * DEG)
                .applyQuaternion(rootRotation);
            const hit = this.raycastCave(origin, dir, 10);
            if (!hit)
                continue;

            const normal = hit.normal;
            if (normal.dot(dir) > 0)
                normal.negate();
            if (Math.abs(normal.dot(rootUp)) > 0.3)
                continue;

            const radius = random.range(this.wallRadiusRange[0], this.wallRadiusRange[1]);
            const pos = hit.point.addScaledVector(normal, this.surfaceLift);
            if (!farEnough(pos, placed, this.minSpacing + radius))
                continue;

            const rotation = new Quaternion().setFromAxisAngle(normal, random.range(0, 360) * DEG)
                .multiply(new Quaternion().setFromUnitVectors(UP, normal));
            this.addPatch(pos, rotation, radius, "Wall", random, placed);
            count++;
        }
    }

    /** First hit must be the cave itself (not furniture), like the Unity collider check. */
    private raycastCave(origin: Vector3, direction: Vector3, maxDistance: number): { point: Vector3, normal: Vector3 } | null {
        const cave = this.room.caveMeshes;
        if (!cave.length)
            return null;
        this.raycaster.set(origin, direction.clone().normalize());
        this.raycaster.far = maxDistance;
        const targets: Mesh[] = [...cave, ...this.room.furnitureMeshes];
        const hits = this.raycaster.intersectObjects(targets, false);
        const first = hits[0];
        if (!first || !cave.includes(first.object as Mesh) || !first.face)
            return null;
        const normal = first.face.normal.clone().transformDirection(first.object.matrixWorld);
        return { point: first.point.clone(), normal };
    }

    private addPatch(position: Vector3, rotation: Quaternion, radius: number, surface: SurfaceKind, random: SeededRandom, placed: Vector3[]) {
        const patch = new BugPatch(this.room.patchParent, position, rotation, radius, surface, random.int(1, 100000));
        patch.onKilled = p => this.handleKilled(p);
        this.patches.push(patch);
        placed.push(position.clone());
    }

    private handleKilled(patch: BugPatch) {
        this.onPatchKilled?.(patch);
        if (this.regrowth && this.regrowths + this.pendingRegrowths.length < this.maxRegrowths && this.alive > 0) {
            const delay = this.regrowDelayRange[0] + Math.random() * (this.regrowDelayRange[1] - this.regrowDelayRange[0]);
            this.pendingRegrowths.push({ patch, at: this.time + delay });
        }
    }
}

function farEnough(p: Vector3, others: Vector3[], spacing: number) {
    const sq = spacing * spacing;
    for (const o of others)
        if (o.distanceToSquared(p) < sq)
            return false;
    return true;
}
