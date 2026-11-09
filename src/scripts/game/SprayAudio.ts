/**
 * Procedural aerosol hiss and a soft "cleared" chime, so the project needs no audio assets.
 * Port of SprayAudio.cs on top of Web Audio. Browsers (iOS in particular) only allow audio after a user gesture,
 * so {@link unlock} must be called from a tap handler.
 */
export class SprayAudio {
    hissVolume = 0.35;
    chimeVolume = 0.5;

    private ctx: AudioContext | null = null;
    private hissGain: GainNode | null = null;
    private hissBuffer: AudioBuffer | null = null;
    private chimeBuffer: AudioBuffer | null = null;
    private hissSource: AudioBufferSourceNode | null = null;
    private volume = 0;
    private target = 0;

    unlock() {
        if (!this.ctx) {
            const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor)
                return;
            this.ctx = new Ctor();
            this.hissBuffer = createHiss(this.ctx);
            this.chimeBuffer = createChime(this.ctx);
            this.hissGain = this.ctx.createGain();
            this.hissGain.gain.value = 0;
            this.hissGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended")
            void this.ctx.resume();
    }

    setSpraying(spraying: boolean) {
        this.target = spraying ? this.hissVolume : 0;
    }

    playCleared() {
        if (!this.ctx || !this.chimeBuffer)
            return;
        const source = this.ctx.createBufferSource();
        source.buffer = this.chimeBuffer;
        const gain = this.ctx.createGain();
        gain.gain.value = this.chimeVolume;
        source.connect(gain).connect(this.ctx.destination);
        source.start();
    }

    update(deltaTime: number) {
        if (!this.ctx || !this.hissGain)
            return;
        const rate = this.target > 0 ? 4 : 2.5;
        const step = deltaTime * rate;
        this.volume = this.volume < this.target ? Math.min(this.target, this.volume + step) : Math.max(this.target, this.volume - step);
        this.hissGain.gain.value = this.volume;

        if (this.volume > 0 && !this.hissSource) {
            this.hissSource = this.ctx.createBufferSource();
            this.hissSource.buffer = this.hissBuffer;
            this.hissSource.loop = true;
            this.hissSource.connect(this.hissGain);
            this.hissSource.start();
        }
        else if (this.volume <= 0 && this.hissSource) {
            this.hissSource.stop();
            this.hissSource.disconnect();
            this.hissSource = null;
        }
    }

    /** Silence everything immediately, e.g. when the page is hidden. */
    suspend() {
        this.target = 0;
        if (this.ctx?.state === "running")
            void this.ctx.suspend();
    }
}

function createHiss(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = rate * 2;
    const fade = Math.round(rate * 0.05);
    const data = new Float32Array(length);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let b0 = 0, b1 = 0, b2 = 0, hp = 0, prev = 0;
    for (let i = 0; i < length; i++) {
        const white = random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.25;
        hp = 0.92 * (hp + pink - prev);
        prev = pink;
        const flutter = 0.85 + 0.15 * Math.sin(i * 2 * Math.PI * 6.5 / rate);
        data[i] = hp * flutter;
    }
    // Crossfade the tail into the head so the loop has no click.
    for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[i] = data[length - fade + i] * (1 - t) + data[i] * t;
    }
    const buffer = ctx.createBuffer(1, length - fade, rate);
    buffer.copyToChannel(data.subarray(0, length - fade), 0);
    return buffer;
}

function createChime(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.round(rate * 0.7);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        const t = i / rate;
        const env = Math.exp(-t * 7) * Math.min(1, t * 400);
        data[i] = env * (0.6 * Math.sin(2 * Math.PI * 880 * t) + 0.3 * Math.sin(2 * Math.PI * 1320 * t) + 0.1 * Math.sin(2 * Math.PI * 1760 * t));
    }
    return buffer;
}
