import { MathUtils, Vector3 } from "three";

export interface TargetingParams {
    /** Max horizontal distance from the player to the nearest edge of a patch. */
    reach: number;
    /** Half-angle of the aiming cone around the screen-center reticle. */
    coneDegrees: number;
    /** Max height difference between the device and the patch center. */
    maxVertical: number;
}

export const DEFAULT_TARGETING: Readonly<TargetingParams> = { reach: 1.2, coneDegrees: 25, maxVertical: 2.2 };

export interface TargetEvaluation {
    inView: boolean;
    inReach: boolean;
    edgeDistance: number;
    /** Degrees between the aim direction and the patch center. */
    angle: number;
}

const _toPatch = new Vector3();

export function evaluateTarget(cameraPosition: Vector3, cameraForward: Vector3, center: Vector3, radius: number,
    p: TargetingParams, out: TargetEvaluation = { inView: false, inReach: false, edgeDistance: 0, angle: 0 }): TargetEvaluation {
    const toPatch = _toPatch.subVectors(center, cameraPosition);
    const horizontal = Math.hypot(toPatch.x, toPatch.z);
    const distance = toPatch.length();
    const angle = distance < 1e-4 ? 0 : cameraForward.angleTo(toPatch) * MathUtils.RAD2DEG;
    const angularRadius = Math.atan2(radius, Math.max(distance, 0.01)) * MathUtils.RAD2DEG;

    out.edgeDistance = Math.max(0, horizontal - radius);
    out.angle = angle;
    out.inView = angle <= p.coneDegrees + angularRadius;
    out.inReach = out.edgeDistance <= p.reach && Math.abs(toPatch.y) <= p.maxVertical;
    return out;
}

/** Hold-to-kill timer: progress only builds while holding on the same target, and resets otherwise. */
export class HoldProgress {
    duration: number;
    value = 0;
    private target: unknown = null;

    constructor(duration = 2) {
        this.duration = duration;
    }

    /** Returns true on the frame the hold completes. */
    tick(holding: boolean, target: unknown, deltaTime: number): boolean {
        if (!holding || target == null || target !== this.target) {
            this.value = 0;
            this.target = holding ? target : null;
            if (!holding || target == null)
                return false;
        }

        this.value = Math.min(1, this.value + deltaTime / Math.max(0.01, this.duration));
        if (this.value < 1)
            return false;

        this.value = 0;
        this.target = null;
        return true;
    }

    reset() {
        this.value = 0;
        this.target = null;
    }
}
