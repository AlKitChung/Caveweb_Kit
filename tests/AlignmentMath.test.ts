import { describe, expect, it } from "vitest";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { average, isStable, levelPose, markerInRoom, MARKER_TOP, pose, Pose, ROOM_FORWARD, ROOM_RIGHT, rootFromMarker, UP } from "../src/scripts/logic/AlignmentMath";

function expectNear(expected: Vector3, actual: Vector3, tolerance = 1e-4) {
    expect(expected.distanceTo(actual), `expected ${expected.toArray()} got ${actual.toArray()}`).toBeLessThan(tolerance);
}

const deg = MathUtils.DEG2RAD;
const yaw = (degrees: number) => new Quaternion().setFromAxisAngle(UP, degrees * deg);

describe("AlignmentMath", () => {
    it("levelPose removes pitch and roll but keeps the marker heading", () => {
        const tilted = new Quaternion().setFromEuler(new Euler(12 * deg, 40 * deg, -7 * deg, "YXZ"));
        const level = levelPose(new Vector3(1, 1, 1), tilted);

        expectNear(UP.clone(), UP.clone().applyQuaternion(level.rotation));
        const top = MARKER_TOP.clone().applyQuaternion(tilted).setY(0).normalize();
        expectNear(top, ROOM_FORWARD.clone().applyQuaternion(level.rotation), 1e-3);
        expectNear(new Vector3(1, 1, 1), level.position);
    });

    it("levelPose handles a marker standing upright", () => {
        const upright = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 90 * deg);
        const level = levelPose(new Vector3(), upright);
        expectNear(UP.clone(), UP.clone().applyQuaternion(level.rotation));
    });

    it("rootFromMarker places the marker on the tracked pose", () => {
        const markerWorld = pose(new Vector3(2, 0.1, -1), yaw(70));
        const inRoom = markerInRoom(new Vector3(), 15, { x: 0.05, y: -0.1 });

        const root = rootFromMarker(markerWorld, inRoom);
        const markerViaRoot = inRoom.position.clone().applyQuaternion(root.rotation).add(root.position);
        const yawViaRoot = root.rotation.clone().multiply(inRoom.rotation);

        expectNear(markerWorld.position, markerViaRoot);
        expect(markerWorld.rotation.angleTo(yawViaRoot)).toBeLessThan(0.01 * deg);
    });

    it("a +90 degree yaw nudge turns the room's forward toward room-left", () => {
        const nudged = rootFromMarker(pose(), markerInRoom(new Vector3(), 90, { x: 0, y: 0 }));
        expectNear(new Vector3(), nudged.position);
        expectNear(ROOM_RIGHT.clone().negate(), ROOM_FORWARD.clone().applyQuaternion(nudged.rotation));
    });

    it("averages jittered samples and rejects outliers", () => {
        const samples: Pose[] = [];
        for (let i = 0; i < 30; i++) {
            const jitter = new Vector3(Math.sin(i) * 0.005, 0, Math.cos(i) * 0.005);
            samples.push(pose(new Vector3(1, 0, 2).add(jitter), yaw(30 + Math.sin(i * 1.7))));
        }

        const mean = average(samples);
        expectNear(new Vector3(1, 0, 2), mean.position, 0.003);
        expect(mean.rotation.angleTo(yaw(30))).toBeLessThan(0.5 * deg);
        expect(isStable(samples, 0.03, 4)).toBe(true);

        samples.push(pose(new Vector3(1.2, 0, 2), yaw(30)));
        expect(isStable(samples, 0.03, 4), "a 20 cm outlier must block the lock").toBe(false);
    });

    it("empty samples are never stable", () => {
        expect(isStable([], 1, 10)).toBe(false);
        const p = average([]);
        expect(p.position.length()).toBe(0);
        expect(p.rotation.equals(new Quaternion())).toBe(true);
    });
});
