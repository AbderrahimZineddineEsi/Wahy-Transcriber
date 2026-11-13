# Two editions, one codebase

This repo holds one app in two editions:

| | **Studio** (this repo) | **Tadqeeq** (the product) |
|---|---|---|
| For | developing and improving the algorithms, training Laya | everyone: the app people download and use |
| Has | everything | lectures, transcription, detection, AI checking, editing, captions, Tafrigh, sources, settings |
| Leaves out | nothing | the Training data and Request log screens and APIs, local Laya, "Save for Laya", the research code, notebooks, datasets and internal docs |
| Name in the app | وحي ستوديو · Wahy Studio | تدقيق · Tadqeeq |

## How the edition is chosen

The server reads `WAHY_EDITION` (`studio` or `tadqeeq`); without it, it reads the `EDITION` file at the repo root,
and without that file it is `studio`. `/api/health` reports the edition and the web app follows it:

- `server/wahy/core/settings.py`: `edition`, `default_edition()`
- `server/wahy/main.py`: the training and request-log routers are mounted only in the studio
- `web/src/shell/edition.ts`: `useStudio()` hides the research places and options; `useEditionSync()` sets the
  product's name and wording (`web/src/shell/i18n/tadqeeq.ts`) and the tab title

Preview the product from this repo: `WAHY_EDITION=tadqeeq ./run.sh` (or `scripts/dev.sh` with the same variable).

## Writing code for both

- A research screen, option or route: gate it with `useStudio()` (web) or `settings.edition == "studio"` (server).
- Words that talk about training: add the product's own wording to `web/src/shell/i18n/tadqeeq.ts`.
- New research files (datasets, notebooks, research scripts): put them under a path listed in
  `packaging/tadqeeq/exclude.txt`, or add the path there.
- Tests run as the studio (`server/tests/conftest.py`, `web/playwright.config.ts`); `test_editions.py` and
  `web/src/edition.test.tsx` check what the product leaves out.

## Publishing the product

```bash
scripts/export_tadqeeq.sh              # writes the product into ../tadqeeq (only committed files)
scripts/export_tadqeeq.sh --push       # also commits there and pushes to its origin
```

`../tadqeeq` is a clone of the private repo `AbderrahimZineddineEsi/tadqeeq`: each export becomes one commit there
("Tadqeeq from Wahy-Transcriber <sha>"). Develop only here; never edit the product repo by hand, the next export
replaces it. The product's README and screenshots live in `packaging/tadqeeq/`.

The product downloads its corpus from this repo's public `corpus-v1` release (`scripts/fetch_corpus.sh`). If this
repo ever becomes private, publish the corpus somewhere public first and point `CORPUS_URL` at it.
