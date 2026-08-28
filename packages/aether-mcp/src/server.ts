#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { AetherMcp, type JsonRpcReq } from "./host.js";

const host = new AetherMcp();

function write(msg: object) {
  const json = JSON.stringify(msg);
  output.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

let buf = Buffer.alloc(0);

function consume(): void {
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const header = buf.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buf = buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const body = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      const msg = JSON.parse(body) as JsonRpcReq;
      const res = host.handle(msg);
      if (res) write(res);
      continue;
    }
    const nl = buf.indexOf(0x0a);
    if (nl < 0) return;
    const line = buf.subarray(0, nl).toString("utf8").trim();
    buf = buf.subarray(nl + 1);
    if (!line || line.startsWith("Content-Length")) continue;
    const msg = JSON.parse(line) as JsonRpcReq;
    const res = host.handle(msg);
    if (res) write(res);
  }
}

input.on("data", (chunk: Buffer | string) => {
  buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  consume();
});
