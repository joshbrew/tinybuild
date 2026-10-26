# Follow-ups

Feature usage is documented in [README](README.md) and the [enhancement guide](tinybuild/docs/enhancements.md). Validation results and platform requirements are recorded in the [testing guide](tinybuild/docs/platform-testing.md).

Keep further work driven by actual applications:

- Add application-specific checks for the next complex stacks, especially custom plugins, routes and native overlays. Existing application source failures are recorded separately from tinybuild failures.
- Run the existing mobile lifecycle, permission and reconnect checks on real Android/iOS devices and prepared SDK hosts.
- Verify macOS execution, signing/notarization and credentialed release workflows on the appropriate hosts. The current portable checks do not replace those runs.
- Extend native capability and remote synchronization recipes only when a concrete application needs them.
