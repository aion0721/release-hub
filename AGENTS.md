# Release Hub project guidance

## Project location

- This directory (`H:\react\release-hub`) is the canonical workspace.
- Do not edit the earlier generated Codex workspace unless the user explicitly asks.
- The project is intended for internal GitLab hosting. OpenAI Sites is not used.

## Product purpose

Release Hub is an internal web application that gathers release-operation information in one place. Users first register a parent release work, then manage details belonging to that release.

The main information is:

- Work timeline, with list, Gantt, and combined views
- Day-of staffing: person, start/end time, location or standby type, and notes
- Approval/request items
- Runbooks and related links

## Technology and structure

- Frontend: React, Vite, TypeScript SPA
- Shared API: lightweight Node.js server using standard modules
- Persistence: JSON under `DATA_DIR`
- CI/CD preparation: GitLab CI
- Deployment packaging: Docker

Important paths:

- `src/App.tsx`: main UI and interactions
- `src/styles.css`: application styling and responsive layout
- `src/types.ts`: shared frontend data shapes
- `src/api.ts`: API client
- `src/sampleData.ts`: frontend fallback/sample data
- `server/main.mjs`: API and production static hosting
- `server/seed.json`: initial server data
- `tests/release-hub.test.mjs`: source and API integration tests
- `public/release-hub-splash.png`: splash image

## Existing product behavior

- The release-work list is the entry point. Details are stored per release work.
- Timeline display can switch between list, Gantt, and combined views.
- The combined view aligns work and staffing lanes on the same time axis.
- Timeline and approval sections use full-width, single-column layout.
- Day-of staffing shows all members on a shared time axis and supports overnight ranges.
- Approval and resource cards open an in-app detail modal first. The modal contains the external-link action.
- External links open in a new browser window/tab with `noopener noreferrer`.
- A splash image appears once per browser session and uses `object-fit: contain` so its edges are not cropped.
- Existing server data missing `staffing` is normalized to an empty array.
- When the API is unavailable during frontend-only development, the UI falls back to sample data and shows an error banner.

## Design intent

- Keep the visual style restrained, professional, and suitable for an internal operations tool.
- Prefer full-width time-based visualizations so their shared time axes remain readable.
- Preserve the parent-release/detail relationship when adding features.
- For time data, support ranges that cross midnight.
- Use Japanese labels in the product UI.
- Keep desktop and mobile layouts usable; verify visual changes in a real browser when layout is involved.

## Development commands

Node.js 20 or later is required.

```bash
npm ci
npm run dev
```

`npm run dev` starts both the SPA and Node API. To run them separately, use
`npm run dev:api` and `npm run dev:web` in different terminals.

Full verification:

```bash
npm test
```

`npm test` must pass TypeScript checking, the production build, and the Node API tests.

Production-style startup:

```bash
npm run build
npm start
```

## Change guidelines

- Inspect current files before editing; preserve user changes and avoid broad rewrites.
- Update types, sample data, server seed/normalization, tests, and README when changing persisted data shapes or user-visible features.
- Do not commit generated output such as `node_modules`, `dist`, or `*.tsbuildinfo`.
- Do not introduce Sites configuration or deployment unless the user reverses the GitLab-hosting decision.
- Do not remove the lightweight Node API in favor of a frontend-only implementation; shared internal use requires server-side persistence.
- Run `npm test` after implementation changes.

## Current verification state

At the time this workspace was created, `npm ci` and `npm test` succeeded from `H:\react\release-hub`. The dependency audit reported one low- and one high-severity vulnerability; do not run forceful automated upgrades without reviewing compatibility and getting user approval when appropriate.
