import { Camera, Quaternion, Vector3, WebGLRenderer } from "three";
import { DEFAULT_TARGETING, evaluateTarget, HoldProgress, TargetEvaluation, TargetingParams } from "../logic/SprayTargeting";
import { BugPatch } from "./BugPatch";
import { BugSpawner } from "./BugSpawner";
import { Haptics } from "./Haptics";
import { SprayAudio } from "./SprayAudio";
import { SprayParticles } from "./SprayParticles";

/** Picks the bug patch under the reticle and kills it after the spray button is held on it for {@link holdSeconds}. Port of SprayController.cs. */
export class SprayController {
    holdSeconds = 2;
    readonly targeting: TargetingParams = { ...DEFAULT_TARGETING };

    active = false;
    holding = false;
    target: BugPatch | null = null;
    /** A patch under the reticle that is still too far away to spray. */
    farCandidate: BugPatch | null = null;
    farCandidateDistance = 0;
    onCleared: ((p: BugPatch) => void) | null = null;

    private readonly hold = new HoldProgress(2);
    private nextTick = 0;
    private time = 0;
    private readonly camPos = new Vector3();
    private readonly camForward = new Vector3();
    private readonly camUp = new Vector3();
    private readonly camQuat = new Quaternion();
    private readonly evaluation: TargetEvaluation = { inView: false, inReach: false, edgeDistance: 0, angle: 0 };

    constructor(private readonly spawner: BugSpawner, readonly particles: SprayParticles, readonly audio: SprayAudio) {
        this.hold.duration = this.holdSeconds;
    }

    get progress() {
        return this.hold.value;
    }

    setHolding(holding: boolean) {
        if (holding && !this.holding && this.active)
            Haptics.light();
        this.holding = holding && this.active;
    }

    update(dt: number, camera: Camera, renderer: WebGLRenderer) {
        this.time += dt;
        if (!this.active) {
            this.holding = false;
            this.setTarget(null);
            this.farCandidate = null;
            this.hold.reset();
            this.updateEffects(false, camera, dt, renderer);
            return;
        }

        this.findTarget(camera);
        if (this.target)
            this.target.sprayProgress = this.hold.value;

        if (this.hold.tick(this.holding, this.target, dt)) {
            const killed = this.target!;
            killed.sprayProgress = 0;
            this.setTarget(null);
            killed.kill();
            Haptics.success();
            this.audio.playCleared();
            this.onCleared?.(killed);
        }
        else if (this.holding && this.target && this.time >= this.nextTick) {
            this.nextTick = this.time + 0.5;
            if (this.hold.value > 0.05)
                Haptics.soft();
        }

        this.updateEffects(this.holding, camera, dt, renderer);
    }

    private findTarget(camera: Camera) {
        camera.getWorldPosition(this.camPos);
        camera.getWorldDirection(this.camForward);

        let best: BugPatch | null = null;
        let bestAngle = Number.MAX_VALUE;
        let far: BugPatch | null = null;
        let farDistance = Number.MAX_VALUE;

        for (const patch of this.spawner.patches) {
            if (!patch.isAlive)
                continue;
            const e = evaluateTarget(this.camPos, this.camForward, patch.center, patch.radius, this.targeting, this.evaluation);
            if (!e.inView)
                continue;
            if (e.inReach) {
                // Keep the current target unless another is clearly more central, so the hold isn't interrupted by jitter.
                const angle = patch === this.target ? e.angle - 6 : e.angle;
                if (angle < bestAngle) {
                    bestAngle = angle;
                    best = patch;
                }
            }
            else if (e.edgeDistance < farDistance) {
                farDistance = e.edgeDistance;
                far = patch;
            }
        }

        this.setTarget(best);
        this.farCandidate = best ? null : far;
        this.farCandidateDistance = far ? farDistance : 0;
    }

    private setTarget(patch: BugPatch | null) {
        if (this.target === patch)
            return;
        if (this.target) {
            this.target.targeted = false;
            this.target.sprayProgress = 0;
        }
        this.target = patch;
        if (patch) {
            patch.targeted = true;
            Haptics.selection();
        }
    }

    private updateEffects(spraying: boolean, camera: Camera, dt: number, renderer: WebGLRenderer) {
        this.audio.setSpraying(spraying);
        this.audio.update(dt);

        const p = this.particles;
        if (spraying) {
            camera.getWorldPosition(this.camPos);
            camera.getWorldDirection(this.camForward);
            camera.getWorldQuaternion(this.camQuat);
            this.camUp.set(0, 1, 0).applyQuaternion(this.camQuat);
            p.origin.copy(this.camPos).addScaledVector(this.camForward, 0.12).addScaledVector(this.camUp, -0.08);
            if (this.target)
                p.direction.subVectors(this.target.center, p.origin).normalize();
            else
                p.direction.copy(this.camForward);
        }
        p.emitting = spraying;
        p.update(dt, renderer);
    }
}
