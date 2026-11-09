const PAPER = "242, 237, 228";
const ACCENT = "178, 58, 46";
const OK = "143, 184, 148";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Line icons in a 1x1 box centred on 0,0; drawn with currentColor so CSS controls the colour. */
const ICONS: Record<string, string> = {
    settings: `<path d="M-.38-.28H.38M-.38 0H.38M-.38.28H.38"/><circle cx="-.14" cy="-.28" r=".085" class="f"/><circle cx=".14" cy="0" r=".085" class="f"/><circle cx="-.14" cy=".28" r=".085" class="f"/>`,
    close: `<path d="M-.28-.28L.28.28M.28-.28L-.28.28"/>`,
    pause: `<path d="M-.14-.3V.3M.14-.3V.3"/>`,
    back: `<path d="M.12-.3L-.18 0L.12.3"/>`,
    check: `<path d="M-.3.02L-.08.24L.32-.24"/>`,
    spray: `<path d="M-.2-.05H.1V.38H-.2ZM-.12-.05V-.2H.08"/><circle cx=".22" cy="-.32" r=".03" class="f"/><circle cx=".28" cy="-.24" r=".03" class="f"/><circle cx=".34" cy="-.16" r=".03" class="f"/>`,
};

/** Replaces every `<i data-icon="name">` with an inline SVG icon. */
export function installIcons(root: ParentNode) {
    root.querySelectorAll<HTMLElement>("i[data-icon]").forEach(el => {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "-0.5 -0.5 1 1");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("class", `icon ${el.className}`.trim());
        svg.innerHTML = ICONS[el.dataset.icon!] ?? "";
        el.replaceWith(svg);
    });
}

/** Canvas sized to its CSS box at the device pixel ratio; draws in CSS pixels. */
abstract class CanvasWidget {
    protected readonly ctx: CanvasRenderingContext2D;
    protected width = 0;
    protected height = 0;

    constructor(readonly canvas: HTMLCanvasElement, private readonly maxRatio = 2) {
        this.ctx = canvas.getContext("2d")!;
    }

    /** Returns false while the canvas is not laid out (hidden screen). */
    protected prepare(): boolean {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w < 1 || h < 1)
            return false;
        const ratio = Math.min(window.devicePixelRatio || 1, this.maxRatio);
        if (w !== this.width || h !== this.height || this.canvas.width !== Math.round(w * ratio)) {
            this.width = w;
            this.height = h;
            this.canvas.width = Math.round(w * ratio);
            this.canvas.height = Math.round(h * ratio);
        }
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.ctx.clearRect(0, 0, w, h);
        return true;
    }
}

export type ScanMode = "searching" | "aligning" | "locked";

/** Camera viewfinder: corner brackets, a sweeping scan line while searching, a progress outline while aligning. */
export class ScanFrame extends CanvasWidget {
    mode: ScanMode = "searching";
    progress = 0;
    private time = 0;

    update(dt: number) {
        this.time += dt;
        if (!this.prepare())
            return;
        const p = this.ctx;
        const t = this.time;
        const locked = this.mode === "locked";
        const color = locked ? OK : PAPER;
        const arm = Math.min(this.width, this.height) * 0.16;
        const pulse = this.mode === "searching" ? 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2)) : 1;
        const inset = locked ? 0 : 4 * Math.sin(t * 2.2);

        p.lineWidth = 3;
        p.lineCap = "round";
        p.lineJoin = "round";
        p.strokeStyle = `rgba(${color}, ${pulse})`;
        const x0 = 2 + inset, y0 = 2 + inset;
        const x1 = this.width - 2 - inset, y1 = this.height - 2 - inset;
        const corner = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
            p.beginPath();
            p.moveTo(ax, ay);
            p.lineTo(bx, by);
            p.lineTo(cx, cy);
            p.stroke();
        };
        corner(x0, y0 + arm, x0, y0, x0 + arm, y0);
        corner(x1 - arm, y0, x1, y0, x1, y0 + arm);
        corner(x1, y1 - arm, x1, y1, x1 - arm, y1);
        corner(x0 + arm, y1, x0, y1, x0, y1 - arm);

        if (this.mode === "searching") {
            const k = 0.5 + 0.5 * Math.sin(t * 1.6);
            const y = y0 + 12 + (y1 - y0 - 24) * k;
            const g = p.createLinearGradient(x0 + 12, 0, x1 - 12, 0);
            g.addColorStop(0, `rgba(${ACCENT}, 0)`);
            g.addColorStop(0.5, `rgba(${ACCENT}, 0.9)`);
            g.addColorStop(1, `rgba(${ACCENT}, 0)`);
            p.strokeStyle = g;
            p.lineWidth = 1.5;
            p.beginPath();
            p.moveTo(x0 + 12, y);
            p.lineTo(x1 - 12, y);
            p.stroke();
            return;
        }

        let remaining = 2 * ((x1 - x0) + (y1 - y0)) * (locked ? 1 : Math.min(1, Math.max(0, this.progress)));
        const mid = (x0 + x1) / 2;
        const path: [number, number][] = [[mid, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0], [mid, y0]];
        p.strokeStyle = `rgb(${locked ? OK : ACCENT})`;
        p.lineWidth = 3;
        p.beginPath();
        p.moveTo(mid, y0);
        for (let i = 1; i < path.length && remaining > 0; i++) {
            const [ax, ay] = path[i - 1];
            const [bx, by] = path[i];
            const len = Math.hypot(bx - ax, by - ay);
            const f = Math.min(1, remaining / len);
            p.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
            remaining -= len;
        }
        p.stroke();
    }
}

/** Screen-centre aiming reticle. Idle: open circle with ticks. Locked: closes in and turns accent coloured. */
export class Reticle extends CanvasWidget {
    locked = false;
    progress = 0;
    private lock = 0;

    update(dt: number) {
        const target = this.locked ? 1 : 0;
        this.lock += Math.sign(target - this.lock) * Math.min(Math.abs(target - this.lock), dt * 6);
        if (!this.prepare())
            return;
        const p = this.ctx;
        const l = this.lock;
        const cx = this.width / 2, cy = this.height / 2;
        const maxR = Math.min(this.width, this.height) / 2 - 3;
        const radius = maxR + (maxR * 0.72 - maxR) * l;
        const mix = (a: number, b: number) => Math.round(a + (b - a) * l);
        const color = `rgba(${mix(242, 178)}, ${mix(237, 58)}, ${mix(228, 46)}, ${0.9 + 0.1 * l})`;
        const gap = (28 * (1 - l)) * Math.PI / 180;
        const tick = 8 + (5 - 8) * l;

        for (let pass = 0; pass < 2; pass++) {
            const shadow = pass === 0;
            p.strokeStyle = p.fillStyle = shadow ? "rgba(0,0,0,0.35)" : color;
            p.lineWidth = shadow ? 3.5 : 1.5;
            p.lineCap = "round";
            for (let q = 0; q < 4; q++) {
                const start = q * Math.PI / 2 - Math.PI / 4 + gap / 2;
                const end = (q + 1) * Math.PI / 2 - Math.PI / 4 - gap / 2;
                p.beginPath();
                p.arc(cx, cy, radius, start, end);
                p.stroke();
            }
            for (let q = 0; q < 4; q++) {
                const a = q * Math.PI / 2;
                const dx = Math.sin(a), dy = -Math.cos(a);
                p.beginPath();
                p.moveTo(cx + dx * (radius + 2), cy + dy * (radius + 2));
                p.lineTo(cx + dx * (radius + 2 + tick), cy + dy * (radius + 2 + tick));
                p.stroke();
            }
            p.beginPath();
            p.arc(cx, cy, shadow ? 2.6 : 1.8, 0, Math.PI * 2);
            p.fill();
        }

        if (this.progress > 0.001) {
            p.strokeStyle = `rgb(${ACCENT})`;
            p.lineWidth = 3;
            p.beginPath();
            p.arc(cx, cy, radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.progress));
            p.stroke();
        }
    }
}

/** Decorative backdrop of tiny specks that drift and twitch, echoing the bugs. */
export class SpeckField extends CanvasWidget {
    private specks: { x: number, y: number, vx: number, vy: number, size: number, phase: number, alpha: number }[] = [];
    private time = 0;

    constructor(canvas: HTMLCanvasElement, private readonly count = 140) {
        super(canvas, 1.5);
    }

    update(dt: number) {
        if (!this.prepare())
            return;
        if (this.specks.length === 0)
            this.seed();
        dt = Math.min(0.1, dt);
        this.time += dt;
        const p = this.ctx;
        for (const s of this.specks) {
            const turn = Math.sin(this.time * 1.3 + s.phase) * 1.8 * dt;
            const c = Math.cos(turn), sn = Math.sin(turn);
            const vx = s.vx * c - s.vy * sn;
            s.vy = s.vx * sn + s.vy * c;
            s.vx = vx;
            const twitch = Math.sin(s.phase * 7.1 + this.time * 3) * Math.sin(s.phase * 3.3 + this.time * 5.2) > 0.45 ? 4 : 1;
            s.x = ((s.x + s.vx * dt * twitch) % this.width + this.width) % this.width;
            s.y = ((s.y + s.vy * dt * twitch) % this.height + this.height) % this.height;
            const flicker = 0.6 + 0.4 * Math.sin(this.time * 2 + s.phase);
            p.fillStyle = `rgba(${PAPER}, ${s.alpha * flicker})`;
            p.beginPath();
            p.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            p.fill();
        }
    }

    private seed() {
        let state = 11;
        const rand = () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 4294967296;
        };
        for (let i = 0; i < this.count; i++) {
            const angle = rand() * Math.PI * 2;
            const speed = 4 + rand() * 10;
            this.specks.push({
                x: rand() * this.width,
                y: rand() * this.height,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 0.8 + rand() * 1.6,
                phase: rand() * 100,
                alpha: 0.08 + rand() * 0.3,
            });
        }
    }
}

/** Circular progress ring around the spray button. */
export class RingProgress {
    private readonly fill: SVGCircleElement;
    private readonly circumference: number;
    private last = -1;

    constructor(host: HTMLElement, thickness = 5) {
        const r = 50 - thickness / 2;
        this.circumference = 2 * Math.PI * r;
        host.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(${PAPER}, 0.22)" stroke-width="${thickness}"/>
            <circle class="ring-fill" cx="50" cy="50" r="${r}" fill="none" stroke="rgb(${PAPER})" stroke-width="${thickness}"
                stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="${this.circumference}" stroke-dashoffset="${this.circumference}"/>
        </svg>`;
        this.fill = host.querySelector(".ring-fill")!;
    }

    set value(v: number) {
        const k = Math.min(1, Math.max(0, v));
        if (Math.abs(k - this.last) < 0.002)
            return;
        this.last = k;
        this.fill.setAttribute("stroke-dashoffset", String(this.circumference * (1 - k)));
        this.fill.style.opacity = k > 0.001 ? "1" : "0";
    }
}
