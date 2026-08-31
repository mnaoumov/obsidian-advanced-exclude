# CHANGELOG

## 4.1.2

- chore(deps): sweep caret-ranged dependencies to latest
- fix(deps): move to obsidian-integration-testing 11 and obsidian-dev-utils 96.5.2
- fix(deps): drop the brace-expansion file: override that breaks a clean install
- docs: point plugin-directory links at community.obsidian.md

## 4.1.1

- docs(demo-vault): unwrap the notes so Obsidian stops rendering a break per line
- docs(readme): render the same in Obsidian's plugin page as on GitHub
- docs(agents): refresh the stale src/ map and the integration-test suffixes

## 4.1.0

- fix: re #14

## 4.0.1

- fix(versions): correct the stale 1.13.8 minAppVersion row for 4.0.0
- chore: update libs

## 4.0.0

- feat!: default Include .gitignore patterns to false
- chore: update obsidian-dev-utils to 94.6.1
- chore: update obsidian-dev-utils to 94.6.0
- fix: re-project fully when a superseding update aborts the first one
- fix: override deepmerge-ts to clear GHSA-ggr8-5vv4-36mx
- test: gate the demo vault by clicking every code button
- chore: teach cspell the advisory wording
- chore: update libs
- docs(demo-vault): give the demo vault its code buttons
- docs: capture the community-store screenshot set
- docs: retire the finished rewrite plan and use NATO placeholders

## 3.4.3

- docs: make the demo vault the documentation, in the standard layout
- feat(demo-vault): migrate to obsidian-dev-utils 93.3.1 and adopt the authoring convention

## 3.4.2

- chore: update libs and adopt obsidian-integration-testing 10

## 3.4.1

- fix: await the settings and ignore-pattern loads before the components that read them
- chore: update libs
- chore: update libs
- chore(vitest): adopt the shared Obsidian plugin vitest configuration

## 3.4.0

- test(index-projection): cover the fast-enable abort and depth sort
- style: satisfy the lint gate
- refactor(settings): move the settings tab onto the declarative settings API
- chore: update libs and clear the npm audit
- docs: fix the demo vault download instructions

## 3.3.2

- chore: update libs

## 3.3.1

- perf(enable): fast-enable big vaults from the persisted hidden set re #10

## 3.3.0

- fix: remove duplicate plugin name from the progress notice
- feat: restore the index instantly on disable re #10

## 3.2.0

- fix: re #11

## 3.1.5

- chore: update libs

## 3.1.4

- chore: update libs
- chore(demo-vault): drop committed Invocables placeholder
- fix(demo-vault): export invoke() from startup script; add Invocables folder

## 3.1.3

- docs: standardize demo-vault README
- docs: drop per-plugin demo-vault setup notes (bootstrap covered by ODU harness)
- docs: unnumber demo-vault setup notes
- Merge branch 'T92': create the Advanced Exclude demo vault (S2)

## 3.1.2

- fix: re #8

## 3.1.1

- test: split vault-size-scaling creation across CDP calls to fit the command timeout
- chore: overexposed
- chore: update libs
- chore: update obsidian-dev-utils to 85.0.0
- test: bump expected PluginBase base child count to 6
- refactor: pass params objects to vault/projection/ignore APIs
- build: lock typescript to 6.0.3
- test: wire integration-testing vitest-setup into integration projects
- chore: update libs
- chore: clean up tsconfig

## 3.1.0

- perf: improve performance

## 3.0.0

- perf: improve performance
- refactor: new template

## 2.1.5

- chore: update template

## 2.1.4

- chore: update libs

## 2.1.3

- chore: update libs
- chore: use $name shorthand for eslint override

## 2.1.2

- chore: update libs
- refactor(test): replace Record\<string, unknown\> mock types with real ones
- chore: remove stale .czrc

## 2.1.1

- refactor: update template

## 2.1.0

- test: add integration tests
- feat: add command handler with open-settings command
- test: add unit tests
- test: add smoke
- chore: update template

## 2.0.23

- chore: update template

## 2.0.22

- chore: update libs

## 2.0.21

- chore: update libs

## 2.0.20

- chore: update libs

## 2.0.19

- chore: update libs

## 2.0.18

- chore: update libs
- chore: lint
- chore: enable markdownlint

## 2.0.17

- fix: build
- chore: update libs

## 2.0.16

- chore: enable conventional commits

## 2.0.15

- Minor changes

## 2.0.14

- Minor changes

## 2.0.13

- Minor changes

## 2.0.12

- Minor changes

## 2.0.11

- Minor changes

## 2.0.10

- Minor changes

## 2.0.9

- Minor changes

## 2.0.8

- Minor changes

## 2.0.7

- Minor changes

## 2.0.6

- Minor changes

## 2.0.5

- Minor changes

## 2.0.4

- Ensure excluded items don't reappear on view reload

## 2.0.3

- Minor changes

## 2.0.2

- Minor changes

## 2.0.1

- Minor changes

## 2.0.0

- Cache in database
- Prevent double load
- Add support for dir/ patterns
- Wait for metadata ready

## 1.3.0

- Add ExcludeMode

## 1.2.5

- Stop loop on plugin unload

## 1.2.4

- Minor changes

## 1.2.3

- Minor changes

## 1.2.2

- Minor changes

## 1.2.1

- New template

## 1.2.0

- Show single progress bar
- Avoid extra count

## 1.1.0

- Speed up on desktop
- Add progress bar
- Evaluate after load

## 1.0.1

- Add warning
- Change default

## 1.0.0

- Initial release
