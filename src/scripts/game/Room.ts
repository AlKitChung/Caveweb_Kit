import { BufferAttribute, BufferGeometry, LineSegments, Mesh, Object3D, Vector3 } from "three";
import { contactShadowMaterial, occluderMaterial, previewCaveMaterial, wireMaterial } from "../render/Materials";
import { SURFACE_KINDS, SurfaceKind } from "./BugPatch";

export interface BugSpot {
    object: Object3D;
    surface: SurfaceKind;
    radius: number;
}

/** Fallback radii (metres) used when a spot's name carries no `_r<mm>` suffix. */
const DEFAULT_RADIUS: Record<SurfaceKind, number> = {
    Floor: 0.4, Rug: 0.3, Desk: 0.19, Chair: 0.17, Bed: 0.24, Armchair: 0.21, Bookshelf: 0.15, Boxes: 0.15, Cabinet: 0.14, Wall: 0.35,
};

// three.js sanitizes and de-duplicates glTF node names ("BugSpot_Rug_r320" may arrive as "BugSpot_Rug_r320_1").
const SPOT_NAME = /^BugSpot_([A-Za-z]+)(?:_r(\d+))?/;

function findByName(root: Object3D, name: string): Object3D | null {
    let found: Object3D | null = null;
    root.traverse(o => {
        if (!found && o.name === name)
            found = o;
    });
    return found;
}

function addGroup(parent: Object3D, name: string): Object3D {
    const group = new Object3D();
    group.name = name;
    parent.add(group);
    return group;
}

function firstMesh(root: Object3D): Mesh | null {
    let found: Mesh | null = null;
    root.traverse(o => {
        if (!found && (o as Mesh).isMesh)
            found = o as Mesh;
    });
    return found;
}

/**
 * The exported Unity room: WorldRoot > RoomContent > { Cave > CaveMesh, Furniture, BugPatches }.
 * Nodes are found by name so the scene needs no custom components to be wired in Unity.
 */
export class Room {
    readonly worldRoot: Object3D;
    readonly content: Object3D;
    readonly furniture: Object3D;
    readonly patchParent: Object3D;
    readonly caveMeshes: Mesh[] = [];
    readonly furnitureMeshes: Mesh[] = [];
    readonly spots: BugSpot[] = [];
    readonly wireframe: LineSegments | null = null;
    readonly furnitureBaseScales: Vector3[] = [];

    constructor(scene: Object3D) {
        // Never fall back to the scene itself: in Needle `visible` is the active flag, and the aligner reparents the root.
        const exported = findByName(scene, "WorldRoot");
        if (!exported)
            console.warn("[CaveAR] No exported room found (WorldRoot); export CaveGameWeb.unity from Unity.");
        this.worldRoot = exported ?? addGroup(scene, "WorldRoot");
        this.content = findByName(this.worldRoot, "RoomContent") ?? addGroup(this.worldRoot, "RoomContent");
        this.furniture = findByName(this.content, "Furniture") ?? addGroup(this.content, "Furniture");
        let patches = findByName(this.content, "BugPatches");
        if (!patches) {
            patches = new Object3D();
            patches.name = "BugPatches";
            this.content.add(patches);
        }
        this.patchParent = patches;

        const cave = findByName(this.content, "CaveMesh") ?? findByName(this.content, "Cave");
        cave?.traverse(o => {
            if ((o as Mesh).isMesh)
                this.caveMeshes.push(o as Mesh);
        });

        this.furniture.traverse(o => {
            if ((o as Mesh).isMesh && !o.name.startsWith("ContactShadow"))
                this.furnitureMeshes.push(o as Mesh);
        });
        for (const child of this.furniture.children)
            this.furnitureBaseScales.push(child.scale.clone());

        this.content.traverse(o => {
            const match = SPOT_NAME.exec(o.name);
            if (match && (SURFACE_KINDS as readonly string[]).includes(match[1])) {
                const surface = match[1] as SurfaceKind;
                const radius = match[2] ? parseInt(match[2], 10) / 1000 : DEFAULT_RADIUS[surface];
                this.spots.push({ object: o, surface, radius });
            }
            if (o.name.startsWith("ContactShadow") && (o as Mesh).isMesh) {
                const mesh = o as Mesh;
                mesh.material = contactShadowMaterial;
                mesh.renderOrder = 1;
            }
        });

        // The Unity wireframe is filled in by a C# script at runtime, so it exports empty; rebuild it here.
        findByName(this.content, "CaveWireframe")?.removeFromParent();
        const source = this.caveMeshes[0];
        if (source) {
            const wire = new LineSegments(buildEdgeGeometry(source.geometry), wireMaterial);
            wire.name = "CaveWireframe";
            wire.renderOrder = 100;
            wire.visible = false;
            source.add(wire);
            (this as { wireframe: LineSegments | null }).wireframe = wire;
        }

        console.log(`[CaveAR] Room: ${this.caveMeshes.length} cave mesh(es), ${this.furniture.children.length} furniture pieces, ${this.spots.length} bug spots`);
    }

    get caveMesh(): Mesh | null {
        return this.caveMeshes[0] ?? null;
    }

    /** AR: the cave only hides virtual content behind the real walls. Preview: draw it as a visible room. */
    setCaveMode(mode: "occluder" | "visible") {
        for (const mesh of this.caveMeshes) {
            mesh.material = mode === "occluder" ? occluderMaterial : previewCaveMaterial;
            mesh.renderOrder = mode === "occluder" ? -10 : 0;
        }
    }

    setVisible(visible: boolean) {
        this.content.visible = visible;
    }
}

/** Unique triangle edges of a mesh with coincident vertices welded. Port of CaveWireframe.BuildEdgeMesh. */
export function buildEdgeGeometry(source: BufferGeometry): BufferGeometry {
    const position = source.getAttribute("position");
    const index = source.getIndex();
    const count = position.count;
    const remap = new Uint32Array(count);
    const weld = new Map<string, number>();
    for (let i = 0; i < count; i++) {
        const key = `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
        let idx = weld.get(key);
        if (idx === undefined) {
            idx = i;
            weld.set(key, i);
        }
        remap[i] = idx;
    }

    const edges = new Set<number>();
    const lines: number[] = [];
    const triCount = index ? index.count : count;
    for (let t = 0; t + 2 < triCount; t += 3) {
        for (let e = 0; e < 3; e++) {
            const ia = index ? index.getX(t + e) : t + e;
            const ib = index ? index.getX(t + (e + 1) % 3) : t + (e + 1) % 3;
            let a = remap[ia], b = remap[ib];
            if (a === b)
                continue;
            if (a > b)
                [a, b] = [b, a];
            const key = a * count + b;
            if (edges.has(key))
                continue;
            edges.add(key);
            lines.push(a, b);
        }
    }

    // Read through the accessor: exported meshes may be quantized or interleaved.
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = position.getX(i);
        positions[i * 3 + 1] = position.getY(i);
        positions[i * 3 + 2] = position.getZ(i);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(lines);
    return geometry;
}
