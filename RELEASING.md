# Publishing

The GitHub Actions workflow publishes a public npm package when a `v*` tag is pushed. It checks that the tag matches `package.json`, installs Bun dependencies, runs type checks and tests, builds the CLI, then runs `npm publish`.

Before the first publish, choose the project license and add an npm granular access token with publish access as the repository secret `NPM_TOKEN`. Push a matching tag such as `v0.1.0`; the workflow uses that secret for the first publication.

After the package exists, configure npm trusted publishing with owner `akadotsh`, repository `mini-browser-agent`, and workflow file `publish.yml`. Then remove the `NPM_TOKEN` secret. Later tagged releases use GitHub OIDC without a long-lived npm token.
