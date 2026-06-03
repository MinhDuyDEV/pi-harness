import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export interface QueueState {
	steerCount: number;
	followUpCount: number;
	hasPending: boolean;
}

export function createQueueTracker() {
	let steerCount = 0;
	let followUpCount = 0;

	function state(): QueueState {
		return {
			steerCount,
			followUpCount,
			hasPending: steerCount > 0 || followUpCount > 0,
		};
	}

	function onInput(streamingBehavior: string | undefined) {
		if (streamingBehavior === "steer") steerCount++;
		else if (streamingBehavior === "followUp") followUpCount++;
	}

	function onTurnEnd() {
		if (steerCount > 0) steerCount--;
	}

	function onAgentEnd() {
		steerCount = 0;
		followUpCount = 0;
	}

	function renderWidget(theme: Theme): Text {
		if (!state().hasPending) return new Text("", 0, 0);
		const parts: string[] = [];
		if (steerCount > 0) parts.push(`${steerCount} steering`);
		if (followUpCount > 0) parts.push(`${followUpCount} follow-up`);
		return new Text(" " + theme.fg("accent", `● Queue — ${parts.join(", ")}`) + " ", 0, 0);
	}

	return { state, onInput, onTurnEnd, onAgentEnd, renderWidget };
}
