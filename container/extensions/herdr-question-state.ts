import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Keep RPIV-specific wiring separate from Herdr's generated reporter.
export default function (pi: ExtensionAPI) {
  pi.events.on("rpiv:ask-user:blocked", (data) => {
    const { active } = data as { active: boolean };
    pi.events.emit("herdr:blocked", {
      active,
      label: "Waiting for your answers",
    });
  });
}
