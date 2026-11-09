import { addComponent, findObjectOfType, onStart, onUpdate } from "@needle-tools/engine";
import { Object3D } from "three";
import "./generated/gen.js";
import { GameManager } from "./scripts/GameManager";
import { UIController } from "./ui/UIController";

onStart(context => {
    // The exported scene may already carry a GameManager (added in Unity); otherwise create one.
    // Components on the three.js Scene itself never become active, so it gets its own object.
    let game = findObjectOfType(GameManager, context);
    if (!game) {
        const host = new Object3D();
        host.name = "Game";
        context.scene.add(host);
        game = addComponent(host, GameManager);
    }
    const ui = new UIController(game, context);
    // Needle's loop also runs inside XR sessions, where window.requestAnimationFrame is paused.
    onUpdate(ctx => ui.update(Math.min(ctx.time.deltaTime, 0.1)));
});
