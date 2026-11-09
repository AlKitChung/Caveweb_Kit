/* eslint-disable */
import { TypeStore } from "@needle-tools/engine"

// Import types
import { GameManager } from "../scripts/GameManager.js";

// Register types
export function registerTypes() {
	TypeStore.add("GameManager", GameManager);
}
registerTypes();
