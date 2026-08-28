import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";

const tools = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));

async function handle(msg: { method?: string; id?: unknown; params?: { name?: string } }) {
  if (msg.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "aether", version: "0.0.1" },
      capabilities: { tools: {} },
    };
  }
  if (msg.method === "tools/list") {
    return {
      tools: tools.tools.map((t: { name: string; description: string }) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: "object" },
      })),
    };
  }
  if (msg.method === "tools/call" && msg.params?.name === "aether_demo_sprint") {
    const report = runSprintProcurement(loadScenario("fixtures/demo/sprint-procurement/scenario.json"));
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: report.ok, results: report.results }, null, 2) }],
    };
  }
  if (msg.method === "tools/call" && msg.params?.name === "aether_demo_night_watch") {
    const report = runNightWatch(loadNightWatch("fixtures/demo/night-watch/scenario.json"));
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: report.ok, results: report.results }, null, 2) }],
    };
  }
  return { content: [{ type: "text", text: "Use the HTTP command bus or `pnpm demo`. Each MCP tool maps 1:1 to a CommandType." }] };
}

let buf = "";
input.setEncoding("utf8");
input.on("data", async (chunk) => {
  buf += chunk;
  while (true) {
    const idx = buf.indexOf("\n");
    if (idx < 0) break;
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line) as { id?: unknown; method?: string; params?: { name?: string } };
    const result = await handle(msg);
    output.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, result }) + "\n");
  }
});
