# Yolu website

A standalone, responsive application landing page. It introduces Yolu's task-centered development workflow without changing the desktop application's entry points or backend.

## Preview and build

From the repository root, with Node.js installed:

```bash
npm run site:dev
```

Open `http://127.0.0.1:4173`. Set `YOLU_SITE_PORT` to use a different port. The preview server binds only to loopback and is for local development.

```bash
npm run site:build
```

Deploy the generated `website/dist/` directory to a static host. No package installation or application backend is required. Google Fonts is optional; system fonts provide the fallback when it is unavailable.

## Content and interactions

- Simplified Chinese by default, with an English toggle and a locally saved language preference.
- A gallery of real production-UI captures showing tasks, Git diffs, and the integrated terminal, with a keyboard-accessible screenshot switcher and enlarged view. The Mint palette is labeled as a development build; the data comes from isolated sample repositories. See [capture provenance](screenshots.md).
- OS-specific package guidance linking to GitHub Releases, rather than assuming an artifact exists.
- Keyboard-accessible tabs, native FAQ disclosures, reduced-motion support, and a copyable Git clone command.
- The approved `web/yolu.svg` master is copied to `assets/yolu.svg`; synchronize this copy if the master changes.

Product claims are based on the repository README and user guide. Release availability is determined by GitHub Releases. Keep repository documentation in English; the public page supports both interface languages.

The `.openai/hosting.json` manifest identifies the associated Sites deployment. Site publishing uses a separate checkout so the application repository's Git history and remote configuration are preserved. Sites access remains private unless its audience is explicitly changed.
