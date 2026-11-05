# Contributing to Yolu

Use [Issues](https://github.com/nite0x/yolu/issues) to report problems, discuss needs or suggest documentation improvements. Yolu focuses on organizing personal development across projects through tasks. Discuss larger changes before implementation, and read [AGENTS.md](AGENTS.md) for repository guidance.

## Reporting a problem

Include the operating system, CPU architecture, Yolu version or source commit, reproduction steps, expected behavior and actual behavior. For Codex integration issues, include the CLI version and a sanitized installation diagnostic report from Settings.

Reproduce with temporary repositories where possible. Do not upload tokens, `service.json`, business databases, private repository contents or complete conversations. Report exploitable vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## Development and checks

See the [development guide](docs/development.md) for prerequisites and architecture. Run commands from the repository root:

```bash
npm ci
npm run web:check
npm run chat:check
npm run web:build
npm run chat:build
node --test scripts/*.test.cjs
npm run workspace:test
npm run chat:test
go test ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
npm run desktop:check
```

Choose checks appropriate to the change. CI runs the complete core suite and selected Go race checks; its exact commands are in [.github/workflows/checks.yml](.github/workflows/checks.yml). Desktop host changes also need `npm run desktop:test` and native lifecycle checks. Installer changes need verification on the target operating system; a cross-compilation is not an installation test.

Use temporary data directories and repositories for lifecycle tests. Keep user repositories, task records, worktree locations, drafts and compatibility identifiers intact. Regenerate icons with `npm run brand:icons` after changing the approved SVG master; see the [brand reference](docs/brand/yolu/README.md).

## Pull requests

Describe the concrete problem, resulting behavior and relevant validation. Include sanitized screenshots for UI changes. Keep changes focused and document any effect on saved tasks, sessions or existing installations. Update the English documentation when changing behavior, commands or release contents.

## Contribution license

This project uses the [Apache License 2.0](LICENSE). Unless explicitly agreed otherwise, contributions intentionally submitted for inclusion in the project are provided under that license. Contributors retain copyright in their contributions. Ensure you have the right to submit the material, and preserve third-party license and copyright notices.
