/**
 * Web replacement for the iOS Taptic plugin. `navigator.vibrate` exists on Android Chrome only;
 * Safari and the iOS App Clip ignore it, so every call silently does nothing there.
 */
const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

function vibrate(pattern: number | number[]) {
    if (!canVibrate)
        return;
    try {
        navigator.vibrate(pattern);
    }
    catch {
        // Some browsers throw when called before a user gesture.
    }
}

export const Haptics = {
    light: () => vibrate(12),
    soft: () => vibrate(6),
    selection: () => vibrate(8),
    success: () => vibrate([18, 40, 28]),
    warning: () => vibrate([40, 60, 40]),
};
