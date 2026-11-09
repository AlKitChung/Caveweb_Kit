import type { Context } from "@needle-tools/engine";
import type { BugPatch, SurfaceKind } from "../scripts/game/BugPatch";
import { Haptics } from "../scripts/game/Haptics";
import type { GameManager, GameState } from "../scripts/GameManager";
import { installIcons, Reticle, RingProgress, ScanFrame, SpeckField } from "./widgets";

interface StoryPage {
    kicker: string;
    title: string;
    titleEn: string;
    body?: string;
    bodyEn?: string;
}

const STORY: StoryPage[] = [
    {
        kicker: "一九八〇年代初 · 洛杉磯",
        title: "獨居的公寓",
        titleEn: "AN APARTMENT IN LOS ANGELES",
        body: "晚年的張愛玲獨居於洛杉磯的一間小公寓。某一天，她開始懷疑鄰居——或是二手家具——帶來了跳蚤。",
        bodyEn: "In the early 1980s, Eileen Chang lived alone in a small Los Angeles apartment. One day she began to suspect that a neighbour, or second-hand furniture, had brought fleas.",
    },
    {
        kicker: "看不見的蟲",
        title: "皮膚上的爬行",
        titleEn: "SOMETHING CRAWLING",
        body: "她總覺得有看不見的微小蟲子在皮膚上爬行、咬噬——腿、腳踝、頭皮。醫生找不到任何蟲體，她卻堅信牠們真實存在。",
        bodyEn: "She felt tiny, invisible insects crawling and biting: her legs, her ankles, her scalp. Doctors found nothing. She remained certain they were real.",
    },
    {
        kicker: "寄生蟲妄想症",
        title: "Ekbom 症候群",
        titleEn: "DELUSIONAL PARASITOSIS",
        body: "現代醫學稱之為寄生蟲妄想症：長期獨居、感官退化與極度焦慮，讓看不見的東西變得真實。現在，輪到你走進她的房間。",
        bodyEn: "Medicine calls it delusional parasitosis, or Ekbom syndrome. Solitude, fading senses and anxiety make the unseen feel real. Now it is your turn to step into her room.",
    },
    {
        kicker: "玩法",
        title: "清除房間",
        titleEn: "HOW TO PLAY",
    },
];

const SURFACE_NAMES: Record<SurfaceKind, [string, string]> = {
    Floor: ["地板", "Floor"],
    Rug: ["地毯", "Rug"],
    Desk: ["書桌", "Desk"],
    Chair: ["椅子", "Chair"],
    Bed: ["床鋪", "Bed"],
    Armchair: ["扶手椅", "Armchair"],
    Bookshelf: ["書架", "Bookshelf"],
    Boxes: ["紙箱", "Boxes"],
    Cabinet: ["電視櫃", "TV cabinet"],
    Wall: ["牆面", "Wall"],
};

const isTouchDevice = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;

/** DOM overlay for the game: the web counterpart of UIController.cs and CaveUI.uxml. */
export class UIController {
    private readonly root: HTMLElement;
    private readonly screens: Partial<Record<GameState, HTMLElement>>;
    private activeScreen: HTMLElement | null = null;
    private readonly timers = new Map<HTMLElement, number>();
    private readonly elements = new Map<string, HTMLElement>();

    private readonly speckField: SpeckField;
    private readonly scanFrame: ScanFrame;
    private readonly reticle: Reticle;
    private readonly sprayRing: RingProgress;

    private storyIndex = 0;
    private noTargetTime = 0;
    private lastRemaining = -1;
    private time = 0;
    private operatorTaps = 0;
    private operatorTapTime = 0;
    private toastTimer = 0;

    constructor(private readonly game: GameManager, private readonly context: Context) {
        this.root = this.$("app");
        installIcons(this.root);
        this.screens = {
            Title: this.$("titleScreen"),
            Story: this.$("storyScreen"),
            Scan: this.$("scanScreen"),
            Play: this.$("hudScreen"),
            End: this.$("endScreen"),
        };
        this.speckField = new SpeckField(this.$("speckField") as HTMLCanvasElement);
        this.scanFrame = new ScanFrame(this.$("scanFrame") as HTMLCanvasElement);
        this.reticle = new Reticle(this.$("reticle") as HTMLCanvasElement);
        this.sprayRing = new RingProgress(this.$("sprayRing"));

        // Taps on the overlay must not also become XR "select" events in AR.
        this.root.addEventListener("beforexrselect", e => e.preventDefault());

        this.bindTitle();
        this.bindStory();
        this.bindScan();
        this.bindHud();
        this.bindEnd();
        this.bindOverlays();
        this.bindOperator();
        this.bindOperatorGesture();

        game.stateChanged.add(s => this.onStateChanged(s));
        game.patchCleared.add(p => this.onPatchCleared(p));
        game.patchRegrew.add(p => this.onPatchRegrew(p));
        this.onStateChanged(game.state);
    }

    private $(id: string): HTMLElement {
        let el = this.elements.get(id);
        if (!el) {
            el = document.getElementById(id) ?? undefined;
            if (!el)
                throw new Error(`[CaveAR] Missing UI element #${id}`);
            this.elements.set(id, el);
        }
        return el;
    }

    private click(id: string, action: () => void) {
        this.$(id).addEventListener("click", () => {
            Haptics.selection();
            action();
        });
    }

    // ---------- Binding ----------

    private bindTitle() {
        this.click("startButton", () => this.game.openStory());
        this.click("titleSettings", () => this.openOperator());
    }

    private bindStory() {
        this.click("storyNext", () => this.nextStoryPage());
        this.click("storySkip", () => this.game.beginScan());
        const screen = this.$("storyScreen");
        let startX = 0;
        let startY = 0;
        screen.addEventListener("pointerdown", e => {
            startX = e.clientX;
            startY = e.clientY;
        });
        screen.addEventListener("pointerup", e => {
            const dx = e.clientX - startX;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(e.clientY - startY))
                return;
            if (dx < 0)
                this.nextStoryPage();
            else if (this.storyIndex > 0)
                this.showStoryPage(this.storyIndex - 1);
        });
    }

    private bindScan() {
        this.click("scanBack", () => this.game.cancelScan());
        this.click("usePlacement", () => this.game.aligner.usePlacement());
        this.click("placeButton", () => {
            if (!this.game.placeHere())
                Haptics.warning();
        });
    }

    private bindHud() {
        this.click("pauseButton", () => {
            this.game.pause();
            this.show(this.$("pauseOverlay"), true);
        });

        const spray = this.$("sprayButton");
        const release = () => this.game.spray.setHolding(false);
        spray.addEventListener("pointerdown", e => {
            e.preventDefault();
            spray.setPointerCapture(e.pointerId);
            this.game.audio.unlock();
            this.game.spray.setHolding(true);
        });
        spray.addEventListener("pointerup", release);
        spray.addEventListener("pointercancel", release);
        spray.addEventListener("lostpointercapture", release);
        spray.addEventListener("contextmenu", e => e.preventDefault());
        window.addEventListener("blur", release);

        // Desktop preview: hold the space bar to spray.
        window.addEventListener("keydown", e => {
            if (e.code === "Space" && !e.repeat && this.game.state === "Play") {
                e.preventDefault();
                this.game.spray.setHolding(true);
            }
        });
        window.addEventListener("keyup", e => {
            if (e.code === "Space")
                release();
        });
    }

    private bindEnd() {
        this.click("replayButton", () => this.game.replay());
        this.click("homeButton", () => this.game.quitToTitle());
    }

    private bindOverlays() {
        const pause = this.$("pauseOverlay");
        this.click("resumeButton", () => {
            this.show(pause, false);
            this.game.resume();
        });
        this.click("pauseRealign", () => {
            this.show(pause, false);
            this.game.realign();
        });
        this.click("pauseSettings", () => this.openOperator());
        this.click("pauseQuit", () => {
            this.show(pause, false);
            this.game.quitToTitle();
        });
        this.click("trackingRealign", () => {
            this.show(this.$("trackingOverlay"), false);
            this.game.realign();
        });
    }

    private bindOperator() {
        const overlay = this.$("operatorOverlay");
        const aligner = this.game.aligner;
        this.click("opClose", () => this.show(overlay, false));
        overlay.addEventListener("pointerdown", e => {
            if (e.target === overlay)
                this.show(overlay, false);
        });
        this.click("opYawM90", () => aligner.nudgeYaw(-90));
        this.click("opYawM1", () => aligner.nudgeYaw(-1));
        this.click("opYawP1", () => aligner.nudgeYaw(1));
        this.click("opYawP90", () => aligner.nudgeYaw(90));
        this.click("opXMinus", () => aligner.nudgeOffset(-0.05, 0));
        this.click("opXPlus", () => aligner.nudgeOffset(0.05, 0));
        this.click("opZMinus", () => aligner.nudgeOffset(0, -0.05));
        this.click("opZPlus", () => aligner.nudgeOffset(0, 0.05));
        this.click("opReset", () => aligner.resetNudges());
        this.click("opRealign", () => {
            this.show(overlay, false);
            this.show(this.$("pauseOverlay"), false);
            this.game.realign();
        });
        this.click("opTime3", () => this.game.setRoundSeconds(180));
        this.click("opTime5", () => this.game.setRoundSeconds(300));
        this.click("opTime8", () => this.game.setRoundSeconds(480));
        this.click("opWireframe", () => this.game.setWireframeVisible(!this.game.wireframeVisible));
        this.click("opRegrowth", () => this.game.setRegrowth(!this.game.regrowth));
    }

    /** Hidden operator access: three-finger triple tap, or F1 on a keyboard. */
    private bindOperatorGesture() {
        window.addEventListener("keydown", e => {
            if (e.key !== "F1")
                return;
            e.preventDefault();
            const overlay = this.$("operatorOverlay");
            if (this.isShown(overlay))
                this.show(overlay, false);
            else
                this.openOperator();
        });
        window.addEventListener("touchstart", e => {
            if (e.touches.length < 3)
                return;
            const now = performance.now() / 1000;
            if (now - this.operatorTapTime > 0.6)
                this.operatorTaps = 0;
            this.operatorTaps++;
            this.operatorTapTime = now;
            if (this.operatorTaps >= 3) {
                this.operatorTaps = 0;
                this.openOperator();
            }
        }, { passive: true });
    }

    // ---------- State ----------

    private onStateChanged(state: GameState) {
        const screenState: GameState = state === "Reveal" || state === "Paused" ? "Play" : state;
        this.$("backdrop").classList.toggle("backdrop--off", state === "Scan" || state === "Reveal" || state === "Play" || state === "Paused");

        const next = this.screens[screenState];
        if (next && next !== this.activeScreen) {
            this.activeScreen?.classList.add("is-hidden");
            this.activeScreen = next;
            this.enter(next, "screen--entering");
        }

        if (state !== "Paused")
            this.show(this.$("pauseOverlay"), false);

        // Needle's menu (with the "open on your phone" QR code) is only useful on a desktop title screen.
        this.context.menu.setVisible(!isTouchDevice && state === "Title" && !this.game.inXR);

        switch (state) {
            case "Title":
                this.$("previewNote").classList.toggle("is-hidden", this.game.arSupported);
                break;
            case "Story":
                this.showStoryPage(0);
                break;
            case "Reveal":
                this.lastRemaining = -1;
                this.$("remainingValue").textContent = "—";
                this.$("totalValue").textContent = "";
                this.$("timeValue").textContent = formatTime(this.game.roundSeconds);
                this.$("clearedFill").style.width = "0%";
                this.showToast("房間已對齊", "ROOM ALIGNED", 2);
                break;
            case "End":
                this.fillEnd();
                break;
        }
    }

    // ---------- Story ----------

    private nextStoryPage() {
        if (this.storyIndex >= STORY.length - 1)
            this.game.beginScan();
        else
            this.showStoryPage(this.storyIndex + 1);
    }

    private showStoryPage(index: number) {
        this.storyIndex = index;
        const page = STORY[index];
        const pageEl = this.$("storyPage");
        pageEl.classList.add("story-page--out");
        this.later(pageEl, index === 0 ? 0 : 180, () => {
            this.$("storyStep").textContent = `${pad2(index + 1)} / ${pad2(STORY.length)}`;
            this.$("storyKicker").textContent = page.kicker;
            this.$("storyTitle").textContent = page.title;
            this.$("storyTitleEn").textContent = page.titleEn;
            const hasBody = !!page.body;
            this.$("storyBody").textContent = page.body ?? "";
            this.$("storyBodyEn").textContent = page.bodyEn ?? "";
            this.$("storyBody").classList.toggle("is-hidden", !hasBody);
            this.$("storyBodyEn").classList.toggle("is-hidden", !hasBody);
            this.$("howTo").classList.toggle("is-hidden", hasBody);
            const last = index === STORY.length - 1;
            this.$("storyNextZh").textContent = last ? "開始掃描" : "繼續";
            this.$("storyNextEn").textContent = last ? "START SCAN" : "CONTINUE";
            this.$("storyScreen").querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("dot--active", i === index));
            pageEl.classList.remove("story-page--out");
        });
    }

    // ---------- Per-frame ----------

    update(dt: number) {
        this.time += dt;
        const state = this.game.state;

        if (!this.$("backdrop").classList.contains("backdrop--off"))
            this.speckField.update(dt);

        switch (state) {
            case "Scan":
                this.updateScan(dt);
                break;
            case "Play":
            case "Paused":
            case "Reveal":
                this.updateHud(dt);
                break;
        }

        const tracking = this.$("trackingOverlay");
        const operatorShown = this.isShown(this.$("operatorOverlay"));
        const showTracking = this.game.trackingLost && !operatorShown;
        if (showTracking !== this.isShown(tracking))
            this.show(tracking, showTracking);
        if (showTracking)
            this.$("trackingDot").classList.toggle("status__dot--dim", this.time % 1.2 > 0.6);

        if (operatorShown)
            this.refreshOperator();
    }

    private updateScan(dt: number) {
        const aligner = this.game.aligner;
        const state = aligner.state;
        const mode = aligner.mode;
        const status = this.$("scanStatus");
        status.classList.toggle("status--aligning", state === "Aligning");
        status.classList.toggle("status--locked", state === "Locked");
        status.querySelector(".status__dot")!.classList.toggle("status__dot--dim", state === "Searching" && this.time % 1.2 > 0.6);

        this.setScanCopy(mode);
        this.$("placeActions").classList.toggle("is-hidden", mode !== "place" || state === "Locked");
        (this.$("placeButton") as HTMLButtonElement).disabled = !aligner.floorHit;
        this.$("usePlacement").classList.toggle("is-hidden", mode !== "marker" || state === "Locked" || !this.game.inXR);

        let zh: string;
        let en: string;
        if (this.game.state === "Scan" && !this.game.inXR && this.game.arSupported && state === "Idle") {
            this.scanFrame.mode = "searching";
            zh = "啟動相機中";
            en = "STARTING AR · ALLOW CAMERA ACCESS";
        }
        else if (state === "Locked") {
            this.scanFrame.mode = "locked";
            zh = "已對齊";
            en = "ALIGNED";
        }
        else if (state === "Aligning") {
            this.scanFrame.mode = "aligning";
            this.scanFrame.progress = aligner.progress;
            zh = `對齊中 ${Math.round(aligner.progress * 100)}%`;
            en = "ALIGNING · HOLD STILL";
        }
        else if (mode === "place") {
            this.scanFrame.mode = "searching";
            zh = aligner.floorHit ? "已找到地面" : "尋找地面中";
            en = aligner.floorHit ? "FLOOR FOUND · TAP PLACE" : "LOOKING FOR THE FLOOR · MOVE SLOWLY";
        }
        else if (mode === "preview") {
            this.scanFrame.mode = "searching";
            zh = "準備房間中";
            en = "PREPARING THE ROOM";
        }
        else {
            this.scanFrame.mode = "searching";
            zh = "尋找標記中";
            en = "LOOKING FOR MARKER";
        }
        this.setText("scanStatusZh", zh);
        this.setText("scanStatusEn", en);
        this.scanFrame.update(dt);
    }

    private setScanCopy(mode: string) {
        if (mode === "place") {
            this.setText("scanTitle", "對準地面中央，點選放置");
            this.setText("scanBodyEn", "Aim the ring at the floor center (where Marker A lies), face the end wall, then tap Place.");
            this.setText("scanFootnote", "放置後可在操作員設定中微調位置與方向。Fine-tune position and yaw in Operator settings.");
        }
        else if (mode === "preview") {
            this.setText("scanTitle", "預覽模式");
            this.setText("scanBodyEn", "No AR camera here, so the room is placed around you. Drag to look around; WASD or a two-finger drag to walk.");
            this.setText("scanFootnote", "在手機上以 AR 遊玩效果最佳。Best played in AR on a phone.");
        }
        else {
            this.setText("scanTitle", "掃描地面中央的標記 A");
            this.setText("scanBodyEn", "Point the camera at Marker A, lying at the center of the floor.");
            this.setText("scanFootnote", "保持手機穩定，距離標記約一公尺。Hold steady, about 1 m above the marker.");
        }
    }

    private updateHud(dt: number) {
        this.reticle.update(dt);
        if (this.game.state === "Reveal")
            return;

        const remaining = this.game.remaining;
        if (remaining !== this.lastRemaining) {
            this.setText("remainingValue", String(remaining));
            this.setText("totalValue", `/ ${this.game.total}`);
            if (this.lastRemaining >= 0)
                this.pulse(this.$("remainingValue"), "capsule__value--bump", 260);
            this.lastRemaining = remaining;
            const cleared = this.game.total === 0 ? 0 : 1 - remaining / this.game.total;
            this.$("clearedFill").style.width = `${cleared * 100}%`;
        }

        const time = this.$("timeValue");
        this.setText("timeValue", formatTime(this.game.timeLeft));
        time.classList.toggle("capsule__value--warn", this.game.timeLeft <= 30);

        const spray = this.game.spray;
        const target = spray.target;
        this.reticle.locked = !!target;
        this.reticle.progress = spray.progress;
        this.sprayRing.value = spray.progress;
        const button = this.$("sprayButton");
        button.classList.toggle("spray--idle", !target);
        button.classList.toggle("spray--pressed", spray.holding);

        const label = this.$("targetLabel");
        if (target) {
            const [zh, en] = SURFACE_NAMES[target.surface];
            this.setText("targetLabel", spray.holding
                ? `清除中 · ${zh}  ${Math.ceil((1 - spray.progress) * spray.holdSeconds)}s`
                : `按住噴灑 · ${zh} ${en}`);
            label.classList.remove("target-label--hidden");
        }
        else {
            label.classList.add("target-label--hidden");
        }

        this.noTargetTime = !target && !spray.farCandidate ? this.noTargetTime + dt : 0;
        if (spray.farCandidate)
            this.setHint(`靠近一點 · ${spray.farCandidateDistance.toFixed(1)} m`, "MOVE CLOSER");
        else if (this.noTargetTime > 6 && this.game.state === "Play")
            this.setHint("環顧四周，尋找蟲群", "LOOK AROUND");
        else
            this.setHint(null, null);
    }

    private setHint(zh: string | null, en: string | null) {
        if (zh) {
            this.setText("hintZh", zh);
            this.setText("hintEn", en ?? "");
        }
        this.$("hint").classList.toggle("hint--hidden", !zh);
    }

    // ---------- Events ----------

    private onPatchCleared(_patch: BugPatch) {
        const remaining = this.game.remaining;
        if (remaining > 0)
            this.showToast("已清除", `CLEARED · ${remaining} LEFT`, 1.4);
    }

    private onPatchRegrew(patch: BugPatch) {
        const [zh, en] = SURFACE_NAMES[patch.surface];
        this.showToast(`牠們回來了 · ${zh}`, `THEY CAME BACK · ${en.toUpperCase()}`, 2.2);
        Haptics.warning();
    }

    private fillEnd() {
        const cleared = this.game.allCleared;
        this.setText("endKicker", cleared ? "清除完成 · ROOM CLEARED" : "時間到 · TIME'S UP");
        this.setText("endTitle", cleared ? "房間暫時安靜了" : "牠們仍在");
        this.setText("endTitleEn", cleared ? "THE ROOM IS QUIET, FOR NOW" : "THEY ARE STILL HERE");
        this.setText("statCleared", `${this.game.total - this.game.remaining}/${this.game.total}`);
        this.setText("statTime", formatTime(this.game.elapsed));
        this.setText("statRegrew", String(this.game.regrowths));
        this.setText("endQuote", cleared ? "「但她知道，牠們還會回來。」" : "「蟲子比時間更有耐心。」");
        this.setText("endQuoteEn", cleared ? "But she knew they would come back." : "The insects are more patient than time.");
    }

    private showToast(zh: string, en: string, seconds: number) {
        this.setText("toastZh", zh);
        this.setText("toastEn", en);
        const toast = this.$("toast");
        toast.classList.remove("toast--hidden");
        clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => toast.classList.add("toast--hidden"), seconds * 1000);
    }

    // ---------- Operator ----------

    private openOperator() {
        this.refreshOperator();
        this.show(this.$("operatorOverlay"), true);
    }

    private refreshOperator() {
        const aligner = this.game.aligner;
        const status: Record<string, string> = { Locked: "已對齊", Aligning: "對齊中", Searching: "尋找中" };
        this.setText("opStatus", status[aligner.state] ?? "未對齊");
        this.setText("opAR", aligner.diagnostics(this.game.inXR ? this.context.xr : null));
        this.setText("opYaw", `${Math.round(aligner.yawOffset)}°`);
        this.setText("opX", `${Math.round(aligner.positionOffset.x * 100)} cm`);
        this.setText("opZ", `${Math.round(aligner.positionOffset.y * 100)} cm`);
        this.$("opWireframe").classList.toggle("switch--on", this.game.wireframeVisible);
        this.$("opRegrowth").classList.toggle("switch--on", this.game.regrowth);
        const seconds = Math.round(this.game.roundSeconds);
        this.$("opTime3").classList.toggle("segmented__item--on", seconds === 180);
        this.$("opTime5").classList.toggle("segmented__item--on", seconds === 300);
        this.$("opTime8").classList.toggle("segmented__item--on", seconds === 480);
    }

    // ---------- Helpers ----------

    /** Avoids DOM writes (and style recalcs) when the text did not change. */
    private setText(id: string, text: string) {
        const el = this.$(id);
        if (el.textContent !== text)
            el.textContent = text;
    }

    private later(el: HTMLElement, ms: number, fn: () => void) {
        clearTimeout(this.timers.get(el));
        this.timers.set(el, window.setTimeout(fn, ms));
    }

    private enter(el: HTMLElement, enteringClass: string) {
        el.classList.add(enteringClass);
        el.classList.remove("is-hidden");
        this.later(el, 30, () => el.classList.remove(enteringClass));
    }

    private show(overlay: HTMLElement, show: boolean) {
        if (show === this.isShown(overlay))
            return;
        if (show)
            this.enter(overlay, "overlay--entering");
        else
            overlay.classList.add("is-hidden");
    }

    private isShown(el: HTMLElement) {
        return !el.classList.contains("is-hidden");
    }

    private pulse(el: HTMLElement, className: string, ms: number) {
        el.classList.add(className);
        window.setTimeout(() => el.classList.remove(className), ms);
    }
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function formatTime(seconds: number) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
