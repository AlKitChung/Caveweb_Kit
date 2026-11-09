import { Behaviour, DeviceUtilities, NeedleXREventArgs, NeedleXRSession, registerType, Renderer, serializable, WebXR, WebXRImageTracking, WebXRImageTrackingModel } from "@needle-tools/engine";
import { HemisphereLight, Object3D, SRGBColorSpace, Color } from "three";
import { crawlTime } from "./render/CrawlingNoiseMaterial";
import { BugPatch } from "./game/BugPatch";
import { BugSpawner } from "./game/BugSpawner";
import { CaveAligner } from "./game/CaveAligner";
import { Haptics } from "./game/Haptics";
import { PreviewControls } from "./game/PreviewControls";
import { Room } from "./game/Room";
import { SprayAudio } from "./game/SprayAudio";
import { SprayController } from "./game/SprayController";
import { SprayParticles } from "./game/SprayParticles";

export type GameState = "Title" | "Story" | "Scan" | "Reveal" | "Play" | "Paused" | "End";

const AUTOSCAN_PARAM = "autoscan";
const PREF_ROUND_SECONDS = "CaveAR.RoundSeconds";
const PREF_REGROWTH = "CaveAR.Regrowth";

/**
 * Round flow (Title → Story → Scan → Reveal → Play ⇄ Paused → End) for the web build.
 * Port of GameManager.cs; it also owns the AR session, the marker tracker and the preview fallback.
 */
@registerType
export class GameManager extends Behaviour {
    /** URL of the printed marker image, relative to the page. */
    @serializable()
    markerUrl: string = "markers/MARKER_A.png";

    /** Printed width of MARKER_A in metres (30 x 20 cm). */
    @serializable()
    markerWidthMeters: number = 0.26;

    @serializable()
    defaultRoundSeconds: number = 300;

    @serializable()
    revealSeconds: number = 1.6;

    /** Max render pixel ratio; phones with 3x screens otherwise render far more pixels than needed. */
    @serializable()
    maxPixelRatio: number = 2;

    state: GameState = "Title";
    roundSeconds = 300;
    timeLeft = 0;
    elapsed = 0;
    allCleared = false;
    cleared = 0;
    arSupported = false;

    room!: Room;
    aligner!: CaveAligner;
    spawner!: BugSpawner;
    spray!: SprayController;
    readonly audio = new SprayAudio();

    readonly stateChanged = new Set<(s: GameState) => void>();
    readonly patchCleared = new Set<(p: BugPatch) => void>();
    readonly patchRegrew = new Set<(p: BugPatch) => void>();

    private tracker!: WebXRImageTracking;
    private preview!: PreviewControls;
    private resumeAfterScan = false;
    private pendingAutoScan = false;
    private revealTime = -1;
    private respawnOnReveal = false;

    get total() { return this.spawner.total; }
    get remaining() { return this.spawner.alive; }
    get regrowths() { return this.spawner.regrowths; }
    get regrowth() { return this.spawner.regrowth; }
    get wireframeVisible() { return !!this.room.wireframe?.visible; }
    get inXR() { return !!NeedleXRSession.active?.running; }
    get trackingLost() { return (this.state === "Play" || this.state === "Paused") && this.aligner.trackingLost; }

    awake() {
        this.context.devicePixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);

        this.room = new Room(this.context.scene);
        this.room.setCaveMode("visible");
        for (const r of this.room.worldRoot.getComponentsInChildren(Renderer))
            r.setInstancingEnabled(false);

        const hemi = new HemisphereLight(new Color().setRGB(0.62, 0.6, 0.57, SRGBColorSpace), new Color().setRGB(0.28, 0.25, 0.22, SRGBColorSpace), 1.2);
        hemi.name = "CaveAmbient";
        this.context.scene.add(hemi);

        this.aligner = new CaveAligner(this.context.scene, this.room.worldRoot);
        this.aligner.onStateChanged = s => this.onAlignStateChanged(s);

        this.spawner = new BugSpawner(this.room);
        this.spawner.regrowth = localStorage.getItem(PREF_REGROWTH) === "1";
        this.spawner.onPatchRegrew = p => this.patchRegrew.forEach(cb => cb(p));

        const particles = new SprayParticles();
        this.context.scene.add(particles.points);
        this.spray = new SprayController(this.spawner, particles, this.audio);
        this.spray.onCleared = p => {
            this.cleared++;
            this.patchCleared.forEach(cb => cb(p));
        };

        const stored = parseFloat(localStorage.getItem(PREF_ROUND_SECONDS) ?? "");
        this.roundSeconds = Number.isFinite(stored) ? stored : this.defaultRoundSeconds;

        this.setupXR();
        this.preview = new PreviewControls(this.context);
        this.room.setVisible(false);

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.audio.suspend();
                this.pause();
            }
        });
    }

    start() {
        const url = new URL(window.location.href);
        if (url.searchParams.has(AUTOSCAN_PARAM)) {
            this.pendingAutoScan = true;
            url.searchParams.delete(AUTOSCAN_PARAM);
            history.replaceState(history.state, "", url);
        }
        this.setState(this.state);
    }

    private setupXR() {
        const scene = this.context.scene;
        const webxr = scene.getComponentInChildren(WebXR) ?? this.gameObject.addComponent(WebXR);
        // The game starts AR from its own "Start scan" button; the room is aligned by the game, not by Needle's placement.
        webxr.createARButton = false;
        webxr.createVRButton = false;
        webxr.createSendToQuestButton = false;
        webxr.createQRCode = true;
        webxr.usePlacementReticle = false;
        webxr.usePlacementAdjustment = false;
        webxr.autoPlace = false;
        webxr.autoCenter = false;
        webxr.useQuicklookExport = false;
        webxr.useXRAnchor = false;
        webxr.useDepthSensing = false;
        webxr.useSpatialGrab = false;
        webxr.defaultAvatar = false;

        const markerTarget = new Object3D();
        markerTarget.name = "MarkerProxy";
        scene.add(markerTarget);
        this.tracker = scene.getComponentInChildren(WebXRImageTracking) ?? this.gameObject.addComponent(WebXRImageTracking);
        this.tracker.addImage(new WebXRImageTrackingModel({
            url: this.markerUrl,
            widthInMeters: this.markerWidthMeters,
            object: markerTarget,
            imageDoesNotMove: true,
            hideWhenTrackingIsLost: true,
        }));
        this.tracker.addEventListener("image-tracking", evt => this.aligner.onImageTracking(evt, NeedleXRSession.active));

        // iOS browsers have no WebXR, but NeedleXRSession.start("immersive-ar") forwards them to the Needle Go App Clip.
        if (DeviceUtilities.isiOS() && !DeviceUtilities.isVisionOS())
            this.arSupported = true;
        NeedleXRSession.isARSupported().then(supported => {
            this.arSupported ||= supported;
            console.log(`[CaveAR] AR supported: ${supported}`);
        });
    }

    // ---------- Flow (called by the UI) ----------

    openStory() {
        this.audio.unlock();
        this.setState("Story");
    }

    /**
     * Starts AR if needed, then the alignment scan. Must run inside a tap handler: browsers only grant
     * an XR session (and on iOS the hand-off to the Needle Go App Clip) from a user gesture.
     */
    beginScan() {
        this.audio.unlock();
        this.resumeAfterScan = false;
        if (!this.inXR && this.arSupported) {
            // iOS hands the page URL to the Needle Go App Clip, which reloads it inside a granted AR session.
            // The flag lets that reload skip the title and story and go straight to the scan.
            const url = new URL(window.location.href);
            url.searchParams.set(AUTOSCAN_PARAM, "1");
            history.replaceState(history.state, "", url);
            NeedleXRSession.start("immersive-ar").then(session => {
                if (!session)
                    this.startScan();
            }).catch(err => {
                console.warn("[CaveAR] Could not start AR, using preview", err);
                this.startScan();
            });
            // On Android the session starts here and onEnterXR begins the scan; iOS reloads into the App Clip.
            this.setState("Scan");
            return;
        }
        this.startScan();
    }

    realign() {
        this.resumeAfterScan = this.spawner.total > 0 && this.remaining > 0 && (this.state === "Play" || this.state === "Paused");
        this.startScan();
    }

    private startScan() {
        this.spray.active = false;
        this.room.setVisible(false);
        this.spawner.setPatchesVisible(false);
        this.room.setCaveMode(this.inXR ? "occluder" : "visible");
        this.preview.enabled = !this.inXR;
        this.setState("Scan");
        this.aligner.beginAlignment(this.inXR, this.tracker.supported);
    }

    cancelScan() {
        this.aligner.cancel();
        if (this.aligner.state === "Locked" && this.resumeAfterScan) {
            this.room.setVisible(true);
            this.spawner.setPatchesVisible(true);
            this.setState("Paused");
            return;
        }
        this.quitToTitle();
    }

    placeHere() {
        return this.aligner.placeHere(this.context.mainCamera!);
    }

    pause() {
        if (this.state !== "Play")
            return;
        this.spray.active = false;
        this.setState("Paused");
    }

    resume() {
        if (this.state !== "Paused")
            return;
        this.spray.active = true;
        this.setState("Play");
    }

    replay() {
        if (this.aligner.state === "Locked")
            this.revealAndPlay(true);
        else
            this.beginScan();
    }

    quitToTitle() {
        this.revealTime = -1;
        this.spray.active = false;
        this.spawner.clear();
        this.room.setVisible(false);
        this.aligner.cancel();
        this.setState("Title");
    }

    /** Leaves AR completely (the HOME button while in AR). */
    exitAR() {
        NeedleXRSession.active?.end();
    }

    setRoundSeconds(seconds: number) {
        this.roundSeconds = seconds;
        localStorage.setItem(PREF_ROUND_SECONDS, String(seconds));
        if (this.state !== "Play" && this.state !== "Paused")
            this.timeLeft = seconds;
    }

    setRegrowth(enabled: boolean) {
        this.spawner.regrowth = enabled;
        localStorage.setItem(PREF_REGROWTH, enabled ? "1" : "0");
    }

    setWireframeVisible(visible: boolean) {
        if (this.room.wireframe)
            this.room.wireframe.visible = visible;
    }

    // ---------- XR lifecycle ----------

    onEnterXR(_args: NeedleXREventArgs) {
        // The iOS App Clip draws the camera feed natively behind the web view, so the page itself must be see-through.
        document.documentElement.classList.add("in-ar");
        this.room.setCaveMode("occluder");
        this.preview.enabled = false;
        // A session started from the Start-scan button, or granted on load inside the iOS App Clip.
        if (this.state === "Scan" || this.state === "Story")
            this.startScan();
    }

    onLeaveXR(_args: NeedleXREventArgs) {
        document.documentElement.classList.remove("in-ar");
        this.aligner.reset();
        this.spray.active = false;
        this.spawner.clear();
        this.room.setVisible(false);
        this.room.setCaveMode("visible");
        if (this.state !== "Title" && this.state !== "Story")
            this.setState("Title");
    }

    private onAlignStateChanged(state: string) {
        if (state !== "Locked" || this.state !== "Scan")
            return;
        if (this.resumeAfterScan) {
            this.room.setVisible(true);
            this.spawner.setPatchesVisible(true);
            this.spray.active = true;
            this.setState("Play");
        }
        else {
            this.revealAndPlay(true);
        }
    }

    private revealAndPlay(respawn: boolean) {
        this.setState("Reveal");
        this.spray.active = false;
        this.room.setVisible(true);
        if (respawn)
            this.spawner.clear();
        this.respawnOnReveal = respawn;
        this.revealTime = 0;
        this.applyReveal(0);
    }

    private applyReveal(t: number) {
        const pieces = this.room.furniture.children;
        const scales = this.room.furnitureBaseScales;
        for (let i = 0; i < pieces.length && i < scales.length; i++) {
            const delay = i * 0.08;
            const k = Math.min(1, Math.max(0, (t - delay) / (this.revealSeconds * 0.6)));
            const eased = 1 - Math.pow(1 - k, 3);
            const s = scales[i];
            pieces[i].scale.set(s.x, s.y * Math.max(0.001, eased), s.z);
        }
    }

    private finishReveal() {
        this.revealTime = -1;
        const pieces = this.room.furniture.children;
        this.room.furnitureBaseScales.forEach((s, i) => pieces[i]?.scale.copy(s));
        if (this.respawnOnReveal)
            this.spawner.spawn((Date.now() & 0x7fffffff) >>> 0);
        this.spawner.setPatchesVisible(true);
        this.cleared = 0;
        this.elapsed = 0;
        this.timeLeft = this.roundSeconds;
        this.allCleared = false;
        this.spray.active = true;
        this.setState("Play");
    }

    // ---------- Frame loop ----------

    update() {
        const dt = Math.min(this.context.time.deltaTime, 0.1);
        crawlTime.value += dt;
        const camera = this.context.mainCamera!;
        const xr = NeedleXRSession.active?.running ? NeedleXRSession.active : null;

        if (this.pendingAutoScan && xr && (this.state === "Title" || this.state === "Story")) {
            this.pendingAutoScan = false;
            this.startScan();
        }

        this.preview.update(dt);
        this.aligner.update(dt, camera, xr);
        this.spawner.update(dt);
        this.spray.update(dt, camera, this.context.renderer);

        if (this.revealTime >= 0) {
            this.revealTime += dt;
            if (this.revealTime >= this.revealSeconds)
                this.finishReveal();
            else
                this.applyReveal(this.revealTime);
        }

        if (this.state !== "Play")
            return;

        this.spray.active = !this.aligner.trackingLost;
        if (this.aligner.trackingLost)
            return;

        this.elapsed += dt;
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.remaining === 0)
            this.endRound(true);
        else if (this.timeLeft <= 0)
            this.endRound(false);
    }

    private endRound(cleared: boolean) {
        this.allCleared = cleared;
        this.spray.active = false;
        this.spawner.cancelRegrowth();
        if (cleared)
            Haptics.success();
        else
            Haptics.warning();
        this.setState("End");
    }

    private setState(state: GameState) {
        this.state = state;
        this.stateChanged.forEach(cb => cb(state));
    }
}
