/** Launches the production daemon; only process lifecycle and port reporting are fixtures. */
import { serve } from "../../src/daemon/server.ts";
const daemon = await serve({ port: 0 });
console.log(JSON.stringify({ a1_ready: true, port: daemon.port, token: daemon.token }));
process.on("SIGTERM", () => { daemon.stop(); process.exit(0); });
