import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import questionState from "../container/extensions/herdr-question-state.ts";

function setup() {
  const events = new EventEmitter();
  const reports = [];
  events.on("herdr:blocked", (report) => reports.push(report));
  questionState({ events });
  return { events, reports };
}

test("an open questionnaire tells Herdr it is waiting for answers", () => {
  const { events, reports } = setup();
  events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "question-1" });
  assert.deepEqual(reports, [{ active: true, label: "Waiting for your answers" }]);
});

test("closing a questionnaire clears its Herdr blocker", () => {
  const { events, reports } = setup();
  events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "question-1" });
  // RPIV uses the same close event for answers, cancellation and errors.
  events.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "question-1" });
  assert.deepEqual(reports.map(({ active }) => active), [true, false]);
});

test("overlapping questionnaires preserve each Herdr blocker", () => {
  const { events, reports } = setup();
  events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "question-1" });
  events.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "question-2" });
  events.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "question-1" });
  events.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "question-2" });
  assert.deepEqual(reports.map(({ active }) => active), [true, true, false, false]);
});

test("prompt announcements alone do not mark the pane blocked", () => {
  const { events, reports } = setup();
  events.emit("rpiv:ask-user:prompt", { toolCallId: "question-1", questions: [] });
  assert.deepEqual(reports, []);
});
