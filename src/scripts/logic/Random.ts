/** Small seeded PRNG (mulberry32) so a round can be reproduced from its seed. */
export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /** Uniform float in [0, 1). */
    next(): number {
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    /** Integer in [min, max). */
    int(min: number, max: number): number {
        return Math.floor(this.range(min, max));
    }

    shuffle<T>(list: T[]): T[] {
        for (let i = list.length - 1; i > 0; i--) {
            const j = this.int(0, i + 1);
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }
}
