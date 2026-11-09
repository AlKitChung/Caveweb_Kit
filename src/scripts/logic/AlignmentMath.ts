import { MathUtils, Quaternion, Vector3 } from "three";

/**
 * Pure pose math used to place the virtual room on top of the real cave from a single floor marker.
 *
 * Room space (three.js, after UnityGLTF's X flip): floor center at the origin, +Y up, the end wall toward +Z,
 * and "room right" (Unity +X) toward -X.
 * Marker space (WebXR image tracking): +Y is the image normal and -Z points toward the top edge of the picture.
 */
export interface Pose {
    position: Vector3;
    rotation: Quaternion;
}

export const UP = Object.freeze(new Vector3(0, 1, 0));
export const ROOM_FORWARD = Object.freeze(new Vector3(0, 0, 1));
export const ROOM_RIGHT = Object.freeze(new Vector3(-1, 0, 0));
/** Local marker axis that points toward the top edge of the printed image. */
export const MARKER_TOP = Object.freeze(new Vector3(0, 0, -1));

const _v0 = new Vector3();
const _v1 = new Vector3();
const _q0 = new Quaternion();

export function pose(position = new Vector3(), rotation = new Quaternion()): Pose {
    return { position, rotation };
}

export function clonePose(p: Pose): Pose {
    return { position: p.position.clone(), rotation: p.rotation.clone() };
}

/** Rotation about +Y that turns {@link ROOM_FORWARD} into the given horizontal direction. */
export function yawRotation(forward: Vector3, out = new Quaternion()): Quaternion {
    return out.setFromAxisAngle(UP, Math.atan2(forward.x, forward.z));
}

/**
 * Removes pitch and roll so the room always stays level with gravity.
 * The returned pose's +Z (room forward) follows the given local axis of the input rotation.
 */
export function levelPose(position: Vector3, rotation: Quaternion, forwardAxis: Vector3 = MARKER_TOP): Pose {
    const forward = _v0.copy(forwardAxis).applyQuaternion(rotation);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) {
        forward.copy(UP).applyQuaternion(rotation);
        forward.y = 0;
    }
    if (forward.lengthSq() < 1e-4)
        forward.copy(ROOM_FORWARD);
    return pose(position.clone(), yawRotation(forward.normalize()));
}

/** Where the marker sits in the room, including operator nudges (yaw in degrees, offset in metres along room right/forward). */
export function markerInRoom(basePosition: Vector3, yawDegrees: number, offsetRightForward: { x: number, y: number }): Pose {
    const position = basePosition.clone()
        .addScaledVector(ROOM_RIGHT, offsetRightForward.x)
        .addScaledVector(ROOM_FORWARD, offsetRightForward.y);
    // Positive yaw turns clockwise seen from above, like the original Unity operator controls.
    const rotation = new Quaternion().setFromAxisAngle(UP, -yawDegrees * MathUtils.DEG2RAD);
    return pose(position, rotation);
}

/** Room root pose such that `inRoom` lands exactly on `markerWorld`. */
export function rootFromMarker(markerWorld: Pose, inRoom: Pose): Pose {
    const rotation = markerWorld.rotation.clone().multiply(_q0.copy(inRoom.rotation).invert());
    const position = markerWorld.position.clone().sub(_v0.copy(inRoom.position).applyQuaternion(rotation));
    return pose(position, rotation);
}

export function average(poses: readonly Pose[]): Pose {
    if (!poses.length)
        return pose();

    const position = new Vector3();
    const forward = _v1.set(0, 0, 0);
    for (const p of poses) {
        position.add(p.position);
        forward.add(_v0.copy(ROOM_FORWARD).applyQuaternion(p.rotation));
    }
    position.divideScalar(poses.length);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6)
        forward.copy(ROOM_FORWARD).applyQuaternion(poses[poses.length - 1].rotation);
    return pose(position, yawRotation(forward.normalize()));
}

/** True when every sample is within the given spread of the average. */
export function isStable(poses: readonly Pose[], maxPositionSpread: number, maxYawSpreadDegrees: number): boolean {
    if (!poses.length)
        return false;

    const mean = average(poses);
    const maxAngle = maxYawSpreadDegrees * MathUtils.DEG2RAD;
    for (const p of poses) {
        if (p.position.distanceTo(mean.position) > maxPositionSpread)
            return false;
        if (p.rotation.angleTo(mean.rotation) > maxAngle)
            return false;
    }
    return true;
}
