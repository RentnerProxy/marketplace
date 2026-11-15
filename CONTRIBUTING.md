# Contributing to RentnerProxy Marketplace

Marketplace is an early public preview. App listings and account registration are still in preparation. Contributions should describe the behavior that actually exists or is being proposed.

## Before starting

Search [existing issues](https://github.com/RentnerProxy/marketplace/issues) and discuss substantial features or architectural changes before implementing them. Use the bug or feature form for a concrete problem; general questions can use a blank issue. Repository discussions are not enabled.

Write repository contributions in English, including issues, pull requests, reviews, commit messages, and documentation. Product translations follow the application's supported languages. Participation follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md), never in a public issue.

The maintainer and code owner is [@RentnerKev](https://github.com/RentnerKev). Keep changes focused, branch from `main`, and open a pull request. Use Conventional Commit titles such as `fix(auth): handle an expired session` or `docs: clarify local setup`.

## Development setup

Use Bun 1.4.4 and the Rust toolchain pinned in [core/rust-toolchain.toml](core/rust-toolchain.toml). Local development also needs PostgreSQL and Valkey. Follow the [README](README.md) for setup and the [appliance guide](docker/README.md) for container operations.

Run commands from the repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

Before starting development, create a private local configuration from [.env.dev.example](.env.dev.example). Configure an isolated development database, Valkey, and `AUTH_ENCRYPTION_KEY`. Keep that key unchanged for existing data. Configure a test SMTP service when exercising the mail worker. Initialize or migrate only the intended development database; `bun run dev` does not grant permission to alter a real deployment.

Use only an isolated development environment for contribution work; never access production credentials, environment files, setup links or data. Keep your local environment files, credentials, session tokens and encryption keys private. You may open a local development setup link privately on your own machine. Never commit, attach or share any setup link or other sensitive data. Share only sanitized reproductions and synthetic fixtures.

## Code and generated files

TypeScript application code lives under `web/src`; native filesystem and process operations live under `core`. Keep routes thin and preserve server-side authentication, authorization, input validation, and storage boundaries. Follow neighboring modules and the checked-in TypeScript, Oxlint, Bun formatter, rustfmt, and Clippy configuration. The [Rust core guide](core/README.md) describes ownership and compatibility contracts.

Keep TypeScript tests under `web/src/tests` and Rust tests under `core/tests`. Do not manually edit `web/src/routeTree.gen.ts`, build output, or other generated files. Regenerate them with their owning tools. Do not manually edit `web/drizzle`; propose schema changes in the schema source and generate migrations with `bun run db:generate`. Database migration execution requires the intended database and authorization; never use production data as a test fixture.

## Verification

Run checks appropriate to the change and report their results and any limitations in the pull request. Relevant commands include:

```bash
bun run project:check
bun run typecheck
bun run lint
bun run test
bun run build
bun run core:format:check
bun run core:lint
bun run core:test
bun run core:coverage
```

For native integration or appliance lifecycle changes, use isolated fixtures with `bun run test:core-integration` and `bun run test:deployment` when the required Docker environment is available. Follow the configured CI gates; passing one local check does not replace the others. The Autofix workflow handles covered formatting and automatic lint fixes; address remaining diagnostics and avoid unrelated rewrites.

Add meaningful tests for behavior, security boundaries, invalid input, and relevant failure paths. Explain when a change does not need an automated test. Do not automatically start or wait for 30-minute endurance runs on ordinary pull requests; those belong to release preparation unless explicitly requested.

## Pull requests and releases

Complete the existing pull request template. Describe the problem, resulting behavior, verification, and compatibility or migration implications. Link a relevant issue with `Fixes #123` or explain why no issue is needed. Wait for required CI and review feedback.

For ordinary coding pull requests, do not add documentation files, README or docs changes, or screenshots unless explicitly requested. Keep the pull request description and appropriate tests current. A requested documentation change is, of course, within scope.

Release preparation, tagging, artifact publication, and deployment are separate actions. A contribution or successful CI run does not authorize publishing a release, creating credentials, changing repository settings, or deploying an instance.
