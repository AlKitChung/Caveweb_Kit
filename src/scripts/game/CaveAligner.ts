import { Camera, Mesh, MeshBasicMaterial, Object3D, Quaternion, RingGeometry, Scene, Vector3 } from "three";
import type { NeedleXREventArgs, NeedleXRSession, WebXRImageTrackingEvent } from "@needle-tools/engine";
import { average, isStable, levelPose, markerInRoom, Pose, rootFromMarker, UP } from "../logic/AlignmentMath";
import { rigToWorld, worldToXR, xrToWorld } from "./XRSpace";

export type AlignState = "Idle" | "Searching" | "Aligning" | "Locked";
/** How the room is being aligned: by the printed marker, by tapping the floor, or (no AR) a desktop/phone preview. */
export type AlignMode = "marker" | "place" | "preview";
export type ARIssue = "None" | "NotStarted" | "Unsupported" | "CameraUnavailable";

const PREF_YAW = "CaveAR.Align.Yaw";
const PREF_OFFSET_X = "CaveAR.Align.OffsetX";
const PREF_OFFSET_Z = "CaveAR.Align.OffsetZ";

const CAMERA_FORWARD = new Vector3(0, 0, -1);

function readPref(key: string, fallback: number) {
    const value = parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Locks the virtual room (`worldRoot`) onto the real cave.
 * Marker mode samples MARKER_A lying at the floor center until the pose is stable (as in the Unity app).
 * When the browser has no image tracking (Android without the Chrome flag) or no marker is seen in time,
 * it falls back to tap-on-floor placement using WebXR hit testing.
 */
export class CaveAligner {
    markerBasePosition = new Vector3();
    requiredSamples = 30;
    maxPositionSpread = 0.03;
    maxYawSpread = 4;
    lostMarkerGrace = 0.5;
    lostTrackingGrace = 2;
    /** Seconds without seeing the marker before offering floor placement. */
    markerSearchTimeout = 6;
    previewAutoLockDelay = 1.5;

    state: AlignState = "Idle";
    mode: AlignMode = "marker";
    markerVisible = false;
    trackingLost = false;
    yawOffset = readPref(PREF_YAW, 0);
    positionOffset = { x: readPref(PREF_OFFSET_X, 0), y: readPref(PREF_OFFSET_Z, 0) };
    /** False once the XR frame proved it has no image tracking API (e.g. Chrome without the WebXR Incubations flag). */
    imageTrackingSupported = true;
    floorHit = false;
    issue: ARIssue = "None";
    onStateChanged: ((state: AlignState) => void) | null = null;

    private readonly samples: Pose[] = [];
    private stateTime = 0;
    private lastSeenTime = -1;
    private time = 0;
    private unhealthySince = -1;
    private anchorHolder: Object3D | null = null;
    private xrAnchor: XRAnchor | null = null;
    private anchorRequested = false;
    private latestMarker: { pose: Pose, time: number } | null = null;
    private readonly floorReticle: Mesh;
    private readonly floorPose: Pose = { position: new Vector3(), rotation: new Quaternion() };
    private readonly tmpPos = new Vector3();
    private readonly tmpRot = new Quaternion();

    constructor(private readonly scene: Scene, readonly worldRoot: Object3D) {
        const ring = new RingGeometry(0.11, 0.14, 48).rotateX(-Math.PI / 2);
        this.floorReticle = new Mesh(ring, new MeshBasicMaterial({ color: 0xf2ede4, transparent: true, opacity: 0.9, depthTest: false }));
        this.floorReticle.name = "FloorReticle";
        this.floorReticle.renderOrder = 200;
        this.floorReticle.visible = false;
        scene.add(this.floorReticle);
    }

    get progress() {
        return this.state === "Locked" ? 1 : Math.min(1, this.samples.length / this.requiredSamples);
    }

    /** True once the camera is tracking the world (always true in the preview). */
    get sessionTracking() {
        return this.mode === "preview" || !this.trackingLost;
    }

    diagnostics(xr: NeedleXRSession | null): string {
        const session = xr ? `${xr.mode} · ${xr.session?.visibilityState ?? "-"}` : "No XR (preview)";
        const tracking = this.imageTrackingSupported ? "image tracking ok" : "no image tracking";
        return `${session} · ${tracking} · ${this.mode} · marker ${this.markerVisible ? "seen" : "-"}`;
    }

    beginAlignment(inXR: boolean, imageTrackingAvailable: boolean) {
        this.releaseAnchor();
        this.samples.length = 0;
        this.markerVisible = false;
        this.trackingLost = false;
        this.unhealthySince = -1;
        this.latestMarker = null;
        this.lastSeenTime = this.time;
        this.mode = !inXR ? "preview" : imageTrackingAvailable && this.imageTrackingSupported ? "marker" : "place";
        this.setState("Searching");
    }

    cancel() {
        this.floorReticle.visible = false;
        if (this.state !== "Locked")
            this.setState("Idle");
    }

    /** Operator or player chooses floor placement instead of waiting for the marker. */
    usePlacement() {
        if (this.mode === "marker" && this.state !== "Locked") {
            this.mode = "place";
            this.samples.length = 0;
            this.setState("Searching");
        }
    }

    /** Places the room on the floor point under the screen-center reticle, facing where the camera looks. */
    placeHere(camera: Camera): boolean {
        if (this.mode !== "place" || !this.floorHit || this.state === "Locked")
            return false;
        camera.getWorldQuaternion(this.tmpRot);
        this.lock(levelPose(this.floorPose.position, this.tmpRot, CAMERA_FORWARD));
        return true;
    }

    nudgeYaw(degrees: number) {
        this.yawOffset = ((this.yawOffset + degrees + 180) % 360 + 360) % 360 - 180;
        this.saveNudges();
    }

    nudgeOffset(dx: number, dz: number) {
        this.positionOffset.x += dx;
        this.positionOffset.y += dz;
        this.saveNudges();
    }

    resetNudges() {
        this.yawOffset = 0;
        this.positionOffset = { x: 0, y: 0 };
        this.saveNudges();
    }

    /** Hooked to WebXRImageTracking's "image-tracking" event; poses arrive in rig space. */
    onImageTracking = (evt: CustomEvent<WebXRImageTrackingEvent>, xr: NeedleXRSession | null) => {
        if (!xr)
            return;
        for (const image of evt.detail.trackedImages) {
            if (image.state !== "tracked")
                continue;
            const position = image.getPosition(new Vector3());
            const rotation = image.getQuaternion(new Quaternion());
            rigToWorld(xr, position, rotation);
            this.latestMarker = { pose: { position, rotation }, time: this.time };
            return;
        }
    };

    /** Per-frame update. `xr` is null outside of an XR session. */
    update(dt: number, camera: Camera, xr: NeedleXREventArgs["xr"] | null) {
        this.time += dt;
        this.stateTime += dt;
        switch (this.state) {
            case "Searching":
            case "Aligning":
                this.updateAlignment(camera, xr);
                break;
            case "Locked":
                this.floorReticle.visible = false;
                this.updateTrackingHealth(xr);
                this.updateAnchor(xr);
                break;
            default:
                this.floorReticle.visible = false;
        }
    }

    private updateAlignment(camera: Camera, xr: NeedleXRSession | null) {
        if (this.mode === "preview") {
            this.markerVisible = this.stateTime > this.previewAutoLockDelay * 0.3;
            if (this.stateTime >= this.previewAutoLockDelay)
                this.lock(this.fallbackMarkerPose(camera));
            return;
        }
        if (!xr)
            return;

        const marker = this.latestMarker && this.time - this.latestMarker.time < 0.12 ? this.latestMarker : null;
        if (marker) {
            if (this.mode === "place")
                this.mode = "marker";
            this.floorReticle.visible = false;
            this.markerVisible = true;
            this.lastSeenTime = this.time;
            this.samples.push(levelPose(marker.pose.position, marker.pose.rotation));
            if (this.samples.length > this.requiredSamples)
                this.samples.shift();
            if (this.state === "Searching")
                this.setState("Aligning");
            if (this.samples.length >= this.requiredSamples && isStable(this.samples, this.maxPositionSpread, this.maxYawSpread))
                this.lock(average(this.samples));
            return;
        }

        if (this.time - this.lastSeenTime > this.lostMarkerGrace) {
            this.markerVisible = false;
            if (this.state === "Aligning") {
                this.samples.length = 0;
                this.setState("Searching");
            }
        }

        if (this.mode === "marker" && (!this.imageTrackingSupported || this.stateTime > this.markerSearchTimeout))
            this.usePlacement();

        if (this.mode === "place")
            this.updateFloorHit(xr);
    }

    private updateFloorHit(xr: NeedleXRSession) {
        const hit = xr.getHitTest();
        // Only accept roughly horizontal, upward-facing surfaces.
        const up = hit ? this.tmpPos.copy(UP).applyQuaternion(hit.quaternion) : null;
        this.floorHit = !!hit && !!up && up.y > 0.8;
        this.floorReticle.visible = this.floorHit;
        if (hit && this.floorHit) {
            this.floorPose.position.copy(hit.position);
            this.floorReticle.position.copy(hit.position);
            this.floorReticle.position.y += 0.003;
        }
    }

    private fallbackMarkerPose(camera: Camera): Pose {
        camera.getWorldPosition(this.tmpPos);
        camera.getWorldQuaternion(this.tmpRot);
        const floor = this.tmpPos.clone().addScaledVector(UP, -1.4);
        return levelPose(floor, this.tmpRot, CAMERA_FORWARD);
    }

    private lock(markerWorld: Pose) {
        this.releaseAnchor();
        const holder = new Object3D();
        holder.name = "CaveAnchor";
        holder.position.copy(markerWorld.position);
        holder.quaternion.copy(markerWorld.rotation);
        this.scene.add(holder);
        holder.add(this.worldRoot);
        this.anchorHolder = holder;
        this.anchorRequested = this.mode !== "preview";
        this.applyRootPose();

        this.samples.length = 0;
        this.trackingLost = false;
        this.floorReticle.visible = false;
        this.setState("Locked");
    }

    private applyRootPose() {
        if (!this.anchorHolder)
            return;
        const inRoom = markerInRoom(this.markerBasePosition, this.yawOffset, this.positionOffset);
        const local = rootFromMarker({ position: new Vector3(), rotation: new Quaternion() }, inRoom);
        this.worldRoot.position.copy(local.position);
        this.worldRoot.quaternion.copy(local.rotation);
        this.worldRoot.scale.setScalar(1);
        this.worldRoot.updateMatrixWorld(true);
    }

    private updateTrackingHealth(xr: NeedleXRSession | null) {
        let healthy = true;
        if (xr) {
            const frame = xr.frame;
            const space = xr.referenceSpace as XRReferenceSpace | null;
            const viewer = frame && space ? frame.getViewerPose(space) : null;
            healthy = !!viewer && !viewer.emulatedPosition && xr.session?.visibilityState !== "hidden";
        }
        if (healthy) {
            this.unhealthySince = -1;
            this.trackingLost = false;
            return;
        }
        if (this.unhealthySince < 0)
            this.unhealthySince = this.time;
        this.trackingLost = this.time - this.unhealthySince > this.lostTrackingGrace;
    }

    /** Lets the AR runtime refine the lock over time (Android; the iOS App Clip has no anchors yet). */
    private updateAnchor(xr: NeedleXRSession | null) {
        if (!xr || !this.anchorHolder)
            return;
        const frame = xr.frame as XRFrame & { createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor> };
        const space = xr.referenceSpace;
        if (!frame || !space)
            return;

        if (this.anchorRequested) {
            this.anchorRequested = false;
            if (typeof frame.createAnchor === "function") {
                const holder = this.anchorHolder;
                const transform = worldToXR(xr, holder.position, holder.quaternion);
                frame.createAnchor(transform, space).then(anchor => {
                    if (holder !== this.anchorHolder) {
                        anchor.delete();
                        return;
                    }
                    this.xrAnchor = anchor;
                }).catch(err => console.warn("[CaveAR] Anchor not available:", err));
            }
        }

        if (this.xrAnchor && frame.trackedAnchors?.has(this.xrAnchor)) {
            const anchorPose = frame.getPose(this.xrAnchor.anchorSpace, space);
            if (anchorPose) {
                xrToWorld(xr, anchorPose.transform, this.tmpPos, this.tmpRot);
                this.anchorHolder.position.copy(this.tmpPos);
                this.anchorHolder.quaternion.copy(this.tmpRot);
            }
        }
    }

    private releaseAnchor() {
        if (this.anchorHolder) {
            this.scene.attach(this.worldRoot);
            this.anchorHolder.removeFromParent();
            this.anchorHolder = null;
        }
        this.xrAnchor?.delete();
        this.xrAnchor = null;
        this.anchorRequested = false;
    }

    /** Called when the XR session ends: anchors and hit tests belong to the old session. */
    reset() {
        this.releaseAnchor();
        this.floorReticle.visible = false;
        this.samples.length = 0;
        this.setState("Idle");
    }

    private saveNudges() {
        localStorage.setItem(PREF_YAW, String(this.yawOffset));
        localStorage.setItem(PREF_OFFSET_X, String(this.positionOffset.x));
        localStorage.setItem(PREF_OFFSET_Z, String(this.positionOffset.y));
        this.applyRootPose();
    }

    private setState(state: AlignState) {
        if (this.state === state)
            return;
        this.state = state;
        this.stateTime = 0;
        console.log(`[CaveAR] Align ${state} (${this.mode})`);
        this.onStateChanged?.(state);
    }
}
