import { describe, expect, it } from "vitest";
import { MathUtils, Quaternion, Vector3 } from "three";
import { DEFAULT_TARGETING, evaluateTarget, HoldProgress } from "../src/scripts/logic/SprayTargeting";

const eye = new Vector3(0, 1.4, 0);
const forward = new Vector3(0, 0, 1);
const p = DEFAULT_TARGETING;

describe("evaluateTarget", () => {
    it("accepts a patch directly ahead within reach", () => {
        const e = evaluateTarget(eye, forward, new Vector3(0, 1.4, 1.2), 0.2, p);
        expect(e.inView).toBe(true);
        expect(e.inReach).toBe(true);
        expect(e.edgeDistance).toBeCloseTo(1.0, 4);
    });

    it("measures reach to the patch edge", () => {
        expect(evaluateTarget(eye, forward, new Vector3(0, 1.4, 1.55), 0.4, p).inReach).toBe(true);
        expect(evaluateTarget(eye, forward, new Vector3(0, 1.4, 1.65), 0.4, p).inReach).toBe(false);
    });

    it("counts a floor patch underfoot as in reach", () => {
        const lookDown = new Vector3(0, -1, 0.6).normalize();
        const e = evaluateTarget(eye, lookDown, new Vector3(0, 0, 0.8), 0.25, p);
        expect(e.inView && e.inReach, "height difference must not count against horizontal reach").toBe(true);
    });

    it("rejects a patch outside the cone", () => {
        const e = evaluateTarget(eye, forward, new Vector3(1, 1.4, 0.5), 0.1, p);
        expect(e.inView).toBe(false);
    });

    it("widens the effective cone for large patches", () => {
        const dir = forward.clone().applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 30 * MathUtils.DEG2RAD));
        const center = eye.clone().add(dir);
        expect(evaluateTarget(eye, forward, center, 0.05, p).inView).toBe(false);
        expect(evaluateTarget(eye, forward, center, 0.4, p).inView).toBe(true);
    });

    it("rejects a patch high on the wall beyond the vertical limit", () => {
        const up = new Vector3(0, 1, 0.2).normalize();
        expect(evaluateTarget(eye, up, new Vector3(0, 4, 0.5), 0.3, p).inReach).toBe(false);
    });
});

describe("HoldProgress", () => {
    const dt = 0.125;
    const holdFor = (hold: HoldProgress, target: object | null, seconds: number) => {
        let completed = false;
        for (let t = 0; t < seconds - 1e-4; t += dt)
            completed = hold.tick(true, target, dt) || completed;
        return completed;
    };

    it("completes after two seconds on the same target", () => {
        const hold = new HoldProgress(2);
        const target = {};
        expect(holdFor(hold, target, 1.875)).toBe(false);
        expect(hold.value).toBeCloseTo(0.9375, 3);
        expect(hold.tick(true, target, dt)).toBe(true);
        expect(hold.value).toBe(0);
    });

    it("resets when released", () => {
        const hold = new HoldProgress(2);
        const target = {};
        holdFor(hold, target, 1.5);
        hold.tick(false, target, dt);
        expect(hold.value).toBe(0);
        expect(holdFor(hold, target, 1.5)).toBe(false);
    });

    it("restarts when the target changes", () => {
        const hold = new HoldProgress(2);
        holdFor(hold, {}, 1.5);
        expect(hold.tick(true, {}, dt)).toBe(false);
        expect(hold.value).toBeCloseTo(0.0625, 3);
    });

    it("does nothing without a target", () => {
        const hold = new HoldProgress(2);
        for (let i = 0; i < 50; i++)
            expect(hold.tick(true, null, dt)).toBe(false);
        expect(hold.value).toBe(0);
    });
});
