# React + TypeScript web app, typed from the server's API, translated by keys

The new frontend is a React + TypeScript app built with Vite and styled with Tailwind, organised in feature folders.
Data from the server is fetched and cached with TanStack Query, and its types are generated from the server's
OpenAPI schema, so a server change that breaks the web app fails the type check. Text is translated through keys
(Arabic first, right-to-left, plus English) instead of translating the rendered Arabic. Reason: the old frontend kept
the whole app in one global object edited from 10 files, refreshed the screen by hand, and keyed 1,486 translations by
full Arabic sentences.

## Considered Options

- Plain TypeScript modules with no framework: less to learn, but the screen-refresh problem would come back with a
  heavily interactive editor and player.
