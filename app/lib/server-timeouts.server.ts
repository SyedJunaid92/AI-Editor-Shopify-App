import { Server } from "node:http";

const WRAPPED = Symbol.for("ai-editor.server-timeouts.wrapped");

/**
 * Node's HTTP server aborts a request after 5 minutes (`requestTimeout`).
 * Generation streams for much longer, so each live server has that timer disabled.
 * The flag lives on the prototype only to avoid wrapping `emit` twice. It must
 * not be the same flag `relax` checks, or every server would inherit "already
 * relaxed" and keep the 5 minute timeout.
 */
const relaxedServers = new WeakSet<Server>();

function relax(server: Server) {
  if (relaxedServers.has(server)) return;
  relaxedServers.add(server);
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 15 * 60 * 1000;
}

const prototype = Server.prototype as typeof Server.prototype & { [WRAPPED]?: boolean };
if (!prototype[WRAPPED]) {
  prototype[WRAPPED] = true;
  const originalEmit = Server.prototype.emit;
  Server.prototype.emit = function (this: Server, ...args: Parameters<Server["emit"]>) {
    const event = args[0];
    if (event === "listening" || event === "connection" || event === "request") {
      relax(this);
    }
    return originalEmit.apply(this, args);
  } as typeof Server.prototype.emit;
}
