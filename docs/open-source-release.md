# Release preparation

Product: **Yolu**. Repository: <https://github.com/nite0x/yolu>.

This is a maintainer checklist and draft release copy for 0.1.0. Checked items describe repository configuration, not proof of publication or native acceptance. Complete the remaining checks against the exact release commit.

## Repository preparation

- [x] Use Yolu as the application and artifact name, with the approved SVG master and generated platform icons.
- [x] Adopt [Apache License 2.0](../LICENSE), update npm/Cargo/Tauri metadata, retain third-party notices and include license texts in the release pipeline.
- [x] Provide an English [README](../README.md), [user guide](guide.md), [development guide](development.md), [migration guide](brand/yolu/migration.md), contribution/security policies and issue templates.
- [x] Use the public Yolu repository URL and retain documented compatibility identifiers.

## Release candidate checks

- [ ] Review and commit the intended changes; select the exact version and commit. Confirm `package.json`, Cargo metadata and the lockfile agree. Do not publish a package built from an unidentified dirty working tree.
- [ ] Run the core checks in [.github/workflows/checks.yml](../.github/workflows/checks.yml) for that commit. Check that the English instructions and exported documentation match the source.
- [ ] Confirm the release uses the Go version declared in `go.mod` and that the reachable-vulnerability checks pass for each native packaging target. Review reported dependency findings even when they have no reachable call path.
- [ ] Run [.github/workflows/desktop.yml](../.github/workflows/desktop.yml) for Apple Silicon macOS, Intel macOS, Windows x64 and Linux x64. Record each native installer/lifecycle result and retain the matching artifacts.
- [ ] Verify a safe upgrade from Work Hub with temporary data, including Windows uninstall registration and Linux package replacement. Confirm tasks, repositories, worktrees and conversation references are retained.
- [ ] Verify macOS Developer ID signing/notarization and Windows publisher signing for production artifacts. Label unsigned manual builds as test artifacts; tag builds require signing on those platforms.
- [ ] Inspect `release.json` for the expected version, revision, source status and signing requirement. Verify the exported files and `SHA256SUMS` against the artifacts intended for publication.
- [ ] Verify `LICENSE` and third-party notices are present in both the exported release directory and installed resources. Review notices for the locked dependency set.
- [ ] Capture sanitized screenshots or a demo of creating a task, working across project directories and continuing a conversation. Verify both English and Simplified Chinese, including system-language selection, saved preference and desktop menu labels.

The desktop workflow uploads Actions artifacts. It does not create a GitHub Release automatically. A successful build or cross-compilation does not replace an installation test on the target operating system.

## Publication

- [ ] Set the repository description, topics, private vulnerability reporting and social preview on GitHub.
- [ ] Create a GitHub Release for the verified commit/tag and attach the matching packages, English guides, migration instructions, license, third-party notices, source metadata and checksums.
- [ ] Verify all download links and state the tested platforms, signing status, tested Codex CLI versions and known limitations in the release notes.
- [ ] Publish the announcement only after checking the actual release and download links.
