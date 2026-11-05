# The engine and envelope builders stay in TypeScript, run on the server in a Node worker

The detection engine (v3, v4, v5) and the Laya envelope builders move into one TypeScript package, `engine/`, and run
on the server in a long-lived Node process that the Python server talks to with one JSON message per line. The browser
never loads the 90 MB corpus. Reason: about 4,200 lines of tuned matching logic would have to be ported to Python with
no way to prove parity except the same golden tests, and the datagen already proves the Node bridge works; keeping one
language for this code means the app and the dataset builder run literally the same functions.

## Considered Options

- Port the engine to Python: one language on the server, but a long, risky port of tuned heuristics.
- Keep the engine in the browser: the 90 MB corpus loads in every tab, and the server and datagen can't reuse it.
