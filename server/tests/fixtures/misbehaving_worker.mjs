// A stand-in for engine/src/worker.ts that misbehaves on request, to test the client's crash and timeout handling.
// Speaks the same protocol: one JSON request per line in, one JSON answer per line out.
//   ping   → "pong"        crash → exits with code 3 after a message on stderr        hang → never answers
import readline from "node:readline";

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (req.cmd === "crash") {
    process.stderr.write("fatal: out of memory (pretend)\n");
    process.exit(3);
  }
  if (req.cmd === "hang") return;
  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: "pong" }) + "\n");
});
