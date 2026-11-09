import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { NeedleXRSession } from "@needle-tools/engine";

/** Needle Engine's world faces the opposite way from raw WebXR space (a 180 degree turn about +Y). */
const flipForward = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();

function rigObject(xr: NeedleXRSession): Object3D | null {
    return (xr.rig?.gameObject as Object3D | undefined) ?? null;
}

/** Rig-space pose (as returned by Needle's `convertSpace` or image tracking) to world space, in place. */
export function rigToWorld(xr: NeedleXRSession, position: Vector3, rotation: Quaternion) {
    const rig = rigObject(xr);
    if (!rig)
        return;
    rig.updateMatrixWorld();
    position.applyMatrix4(rig.matrixWorld);
    rig.matrixWorld.decompose(_s, _q, _s);
    rotation.premultiply(_q);
}

/** Raw WebXR pose (reference space) to world space. */
export function xrToWorld(xr: NeedleXRSession, transform: XRRigidTransform, outPosition: Vector3, outRotation: Quaternion) {
    const converted = xr.convertSpace(transform);
    outPosition.copy(converted.position);
    outRotation.copy(converted.quaternion);
    rigToWorld(xr, outPosition, outRotation);
}

/** World pose to a WebXR rigid transform in the session's reference space (inverse of {@link xrToWorld}). */
export function worldToXR(xr: NeedleXRSession, position: Vector3, rotation: Quaternion): XRRigidTransform {
    const p = position.clone();
    const q = rotation.clone();
    const rig = rigObject(xr);
    if (rig) {
        rig.updateMatrixWorld();
        p.applyMatrix4(_m.copy(rig.matrixWorld).invert());
        rig.matrixWorld.decompose(_s, _q, _s);
        q.premultiply(_q.invert());
    }
    p.applyQuaternion(flipForward);
    q.premultiply(flipForward);
    return new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
}
