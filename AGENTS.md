# Repository Guidelines

This repository starts intentionally clean; treat these guardrails as the source of truth so every new module lands consistent and reviewable from day one.

## Project Structure & Module Organization
- Application code lives in `src/`, grouped by feature (`src/auth`, `src/payments`, etc.) with shared utilities in `src/lib`.
- Tests mirror the source tree inside `tests/feature_name.spec.ts` so reviewers can jump between implementation and coverage.
- Static assets (seed data, fixtures, schemas) sit in `assets/`, while long-form notes stay in `docs/`.
- Use `scripts/` for helper CLIs (bootstrap, data loads) to avoid sprinkling shell logic into package scripts.

## Build, Test, and Development Commands
- `npm install` — installs dependencies; pin Node 20+ with `.nvmrc` to prevent mismatched lockfiles.
- `npm run dev` — launches the local server with hot reload; keep it stateless so parallel agents can run it concurrently.
- `npm run build` — produces the optimized bundle or compiled binaries in `dist/`; never commit the output.
- `npm test` — executes the full automated test suite; add `-- --watch` for interactive loops.
- `npm run lint` — runs ESLint + Prettier checks; wire it into CI before opening a PR.

## Coding Style & Naming Conventions
- Favor TypeScript with strict mode; use 2-space indentation and trailing commas.
- Components, classes, and types use PascalCase; files and directories use kebab-case (e.g., `src/user-profile/service.ts`).
- Guard module boundaries by exporting through `index.ts` barrels so imports remain shallow.
- Run `npm run lint` or `npm run format` before every push to keep diffs noise-free.

## Testing Guidelines
- Default to Vitest/Jest with `*.spec.ts` filenames; integration suites belong under `tests/integration/`.
- Mock external services via test doubles in `tests/mocks/` and keep fixtures deterministic for replayable runs.
- Target ≥90% critical-path coverage (`npm run test -- --coverage`) and document any intentional gaps in the PR.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat(api): add rate limiter`) so release tooling stays predictable.
- Scope each PR to one logical change, link issues in the description, and include screenshots or cURL traces for user-facing updates.
- Before requesting review, ensure `npm run lint && npm test` are green and note any follow-ups in a checklist.

## Security & Configuration Tips
- Keep secrets in environment files; commit only sanitized templates such as `.env.example`.
- Validate incoming config in a dedicated `config/validation.ts` module to crash fast during misconfiguration.
