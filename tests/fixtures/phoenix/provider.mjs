import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

// No network, real model, or credentials. Pi still executes its real read tool.
export default function (pi) {
  let calls = 0;
  pi.registerProvider("phoenix-fixture", {
    apiKey: "synthetic-not-a-secret",
    baseUrl: "http://127.0.0.1:1",
    api: "phoenix-fixture",
    models: [
      {
        id: "fixture-model",
        name: "Fixture model",
        reasoning: false,
        input: ["text"],
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 1000,
      },
    ],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      (async () => {
        await options?.onPayload?.(
          { model: model.id, messages: context.messages },
          model,
        );
        const first = calls++ === 0;
        const message = {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: "pending",
          content: [],
          usage: {
            input: 17,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 22,
            cost: {
              input: 0.000017,
              output: 0.00001,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.000027,
            },
          },
        };
        stream.push({ type: "start", partial: message });
        if (first) {
          for (const [i, path] of [
            "/fixture/marker.txt",
            "/fixture/does-not-exist.txt",
          ].entries()) {
            message.content.push({
              type: "toolCall",
              id: `fixture-read-${i}`,
              name: "read",
              arguments: { path },
            });
            stream.push({
              type: "toolcall_start",
              contentIndex: i,
              partial: message,
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: i,
              toolCall: message.content[i],
              partial: message,
            });
          }
        } else {
          message.content.push({
            type: "text",
            text: "SYNTHETIC_RESPONSE: fixture complete",
          });
          stream.push({
            type: "text_start",
            contentIndex: 0,
            partial: message,
          });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: message.content[0].text,
            partial: message,
          });
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: message.content[0].text,
            partial: message,
          });
        }
        message.stopReason = first ? "toolUse" : "stop";
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
        stream.end();
      });
      return stream;
    },
  });
}
