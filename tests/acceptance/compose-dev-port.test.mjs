// A custom DEV_PORT changes only the host side of the loopback binding.
import { expect } from "vitest";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({ name: "custom-dev-port", settings: { DEV_PORT: "15173" } });

test("a custom host port keeps the loopback binding and container port 5173", ({ project: p }) => {
  const ports = p.config().services["pi-box"].ports;
  expect(ports).toHaveLength(1);
  expect(ports[0]).toMatchObject({ host_ip: "127.0.0.1", target: 5173 });
  expect(String(ports[0].published)).toBe("15173");
});
