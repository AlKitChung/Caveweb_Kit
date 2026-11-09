import type { Context } from "@needle-tools/engine";
import { Euler, Vector3 } from "three";

/**
 * First-person controls for the non-AR preview (desktop browsers, or phones without WebXR).
 * Drag to look around; WASD / arrow keys or a two-finger drag to walk. Ignores touches on the UI.
 */
export class PreviewControls {
    eyeHeight = 1.6;
    walkSpeed = 1.4;
    lookSpeed = 0.005;

    private _enabled = false;
    private yaw = Math.PI;
    private pitch = -0.15;
    private readonly keys = new Set<string>();
    private readonly pointers = new Map<number, { x: number, y: number }>();
    private walkInput = { x: 0, z: 0 };
    private placed = false;
    private readonly euler = new Euler(0, 0, 0, "YXZ");
    private readonly move = new Vector3();

    constructor(private readonly context: Context) {
        const canvas = context.renderer.domElement;
        canvas.style.touchAction = "none";
        canvas.addEventListener("pointerdown", this.onDown);
        window.addEventListener("pointermove", this.onMove);
        window.addEventListener("pointerup", this.onUp);
        window.addEventListener("pointercancel", this.onUp);
        window.addEventListener("keydown", e => this.keys.add(e.key.toLowerCase()));
        window.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value: boolean) {
        this._enabled = value;
        if (value && !this.placed) {
            this.placed = true;
            const cam = this.context.mainCamera;
            cam?.position.set(0, this.eyeHeight, 0);
        }
        if (!value) {
            this.pointers.clear();
            this.walkInput = { x: 0, z: 0 };
        }
    }

    private onDown = (e: PointerEvent) => {
        if (!this._enabled)
            return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };

    private onMove = (e: PointerEvent) => {
        const last = this.pointers.get(e.pointerId);
        if (!this._enabled || !last)
            return;
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        last.x = e.clientX;
        last.y = e.clientY;
        if (this.pointers.size >= 2) {
            this.walkInput.x = -dx * 0.02;
            this.walkInput.z = dy * 0.02;
            return;
        }
        this.yaw -= dx * this.lookSpeed;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * this.lookSpeed));
    };

    private onUp = (e: PointerEvent) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2)
            this.walkInput = { x: 0, z: 0 };
    };

    update(dt: number) {
        const cam = this.context.mainCamera;
        if (!this._enabled || !cam)
            return;

        let forward = this.walkInput.z;
        let strafe = this.walkInput.x;
        if (this.keys.has("w") || this.keys.has("arrowup")) forward -= 1;
        if (this.keys.has("s") || this.keys.has("arrowdown")) forward += 1;
        if (this.keys.has("a") || this.keys.has("arrowleft")) strafe -= 1;
        if (this.keys.has("d") || this.keys.has("arrowright")) strafe += 1;
        if (this.keys.has("q")) this.yaw += dt * 1.5;
        if (this.keys.has("e")) this.yaw -= dt * 1.5;

        this.euler.set(this.pitch, this.yaw, 0);
        cam.quaternion.setFromEuler(this.euler);

        if (forward || strafe) {
            this.move.set(strafe, 0, forward).applyAxisAngle(new Vector3(0, 1, 0), this.yaw);
            if (this.move.lengthSq() > 1)
                this.move.normalize();
            cam.position.addScaledVector(this.move, this.walkSpeed * dt);
        }
        cam.position.y = this.eyeHeight;
    }
}
