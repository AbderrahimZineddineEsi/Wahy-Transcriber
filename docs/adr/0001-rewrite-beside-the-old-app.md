# Rewrite beside the old app, one tested phase per session

The whole project is rewritten on branch `factory-reset`, but the new code is built in new folders (`server/`, `web/`,
`engine/`) next to the old app (`backend/`, `js/`, `css/`, `index.html`), which keeps running until the acceptance phase
passes; only then is it deleted. Each phase is one session and ends with green tests. Before any code moves, the old
app's outputs (findings, envelopes, captions, exports) are saved as golden files, and the new code must reproduce them
exactly. Reason: Laya's results depend on findings and envelopes staying byte-identical, and a rewrite that can't be
compared with the old app loses features and parity silently.

## Considered Options

- Change the old code in place, step by step: rejected; the user wants a new architecture and a full restyle, and
  every intermediate state would have to be designed twice.
- One literal big-bang session: impossible to verify, and nothing would be learnable from it.
