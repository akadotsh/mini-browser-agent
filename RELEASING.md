# Publishing

Merge the release PR before publishing. The README contains the global install command and headed Chrome extension setup.

The GitHub Actions workflow publishes a public npm package when a `v*` tag is pushed. It checks that the tag matches `package.json`, installs Bun dependencies, runs type checks and tests, and builds the CLI before publishing. It skips versions that already exist on npm.

Configure npm trusted publishing with owner `akadotsh`, repository `mini-browser-agent`, and workflow file `publish.yml`. Push a tag matching the package version to publish it through GitHub OIDC. A GitHub `NPM_TOKEN` secret can be used as a fallback.
