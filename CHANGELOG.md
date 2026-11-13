# CHANGELOG

## 5.0.0

Exclude patterns now have two homes, shown as two sections of the settings tab:

- **Global patterns** are kept in the plugin settings, so Obsidian Sync carries them to every device.
- **Local patterns** are the `.obsidianignore` file at the vault root, for this device only. The section edits the file directly. Obsidian Sync never carries a dot file; `git`, `Syncthing` and other sync tools may.

Both always apply, global first, so a `!negation` in `.obsidianignore` can re-include on one device what a global pattern hides everywhere.

**Upgrading from 4.2: nothing to do.** Your `.obsidianignore` keeps working as it is, and now shows under **Local patterns**. **Global patterns** start empty. The copy of the file's text that 4.2 also kept in `data.json` is dropped on the first load, so nothing applies twice.

Every pattern box now checks its lines as you type: errors (a line that matches nothing) in red, warnings (a line that probably means something else) in amber. Nothing is blocked. An outside edit of `.obsidianignore` that brings an error, and a profile's `@import file:` of a missing file, each show a notice once.

A new `Soft` exclude mode leaves an ignored file in the Files pane and in links, and keeps it out of search, the quick switcher, link suggestions, graph, unlinked mentions and Bases, exactly where Obsidian's own `Excluded files` applies. Each of those features has its own toggle, so a folder can be left out of unlinked mentions only. In this mode, **Exclude notes by property** hides notes by a frontmatter value, such as `visibility: gm-only`.

This release has 6 new features and 4 fixes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add global exclude patterns, kept in the synced plugin settings
- keep per-device patterns in `.obsidianignore` beside the synced global patterns
- check exclude patterns as you type, and report errors an outside `.obsidianignore` edit brings
- add a `Soft` exclude mode and an **Exclude notes by property** setting
- choose which features the `Soft` exclude mode reaches
- add a **Report a bug** command

### Fixed

- save `.obsidianignore` when typing pauses, and judge files by the applied patterns until Apply
- refresh graph views after the excluded files change
- keep resolving links after hiding a note whose parse is in flight
- keep the space before the plugin name in the Publish warning's disable button

## 4.2.1

This release has 1 fix and 1 documentation change. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- show the profile pattern syntax in the profile editor as rendered inline code

### Documentation

- **readme:** lead the Debugging section with `Advanced Debug Mode`

## 4.2.0

This release has 2 new features, 5 fixes, 1 improvement and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **profiles:** import a vault file with `@import file:<path>`
- add switchable settings profiles composed with `@import`

### Fixed

- **startup:** batch the related-links passes of the metadata cache's startup purge
- **projection:** skip the adapter's recursive folder listing during a re-show
- **projection:** skip File recovery snapshots of re-shown notes
- **settings:** apply a settings save made outside the settings tab
- **settings:** link the whitelist demo note instead of a missing README heading

### Improved

- keep pattern edits and re-enables fast at real-vault scale (re #16 - \[BUG\] Are .gitignore comments supported?)

### Documentation

- mark plugin names as code

## 4.1.4

This release has 2 fixes and 1 documentation change. 6 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- re-apply Files Pane hiding to an explorer built after the projection (re #13 - \[BUG\] Exclude mode - FIles Pane : is not working for me)
- mark plugin names as code in markdown, comments and UI

### Documentation

- document # comments in .obsidianignore, with a regression test (re #16 - \[BUG\] Are .gitignore comments supported?)

## 4.1.3

This release has 4 fixes and 6 documentation changes. 17 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **ignore-patterns:** merge applying an ignore file edited while the plugin runs
- **test:** merge the headless demo-vault toolkit install
- **deps:** override smol-toml to clear a denial-of-service advisory
- **build:** wire build:compile to buildCompile and drop the duplicate leaf script

### Documentation

- **contributing:** merge the PR base branch correction
- replace the private rule-id citations with what they assert
- name the library and the sibling plugins so a reader can resolve them
- replace the private tracker references with what they pointed at
- say where the debug command is run
- name the unversioned demo-vault asset and the folder it unzips into

## 4.1.2

This release has 2 fixes and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **deps:** move to `obsidian-integration-testing` 11 and `obsidian-dev-utils` 96.5.2
- **deps:** drop the brace-expansion file: override that breaks a clean install

### Documentation

- point plugin-directory links at community.obsidian.md

## 4.1.1

This release has 3 documentation changes.

### Documentation

- **demo-vault:** unwrap the notes so Obsidian stops rendering a break per line
- **readme:** render the same in Obsidian's plugin page as on `GitHub`
- **agents:** refresh the stale src/ map and the integration-test suffixes

## 4.1.0

This release has 1 fix.

### Fixed

- \[BUG\] data.json is emptied then filled with default settings every reload after "include .gitignore patterns" is disabled. (#14)

## 4.0.1

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **versions:** correct the stale 1.13.8 minAppVersion row for 4.0.0

## 4.0.0

This release has 1 breaking change, 2 fixes and 3 documentation changes. 5 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Breaking changes

- default Include .gitignore patterns to false

### Fixed

- re-project fully when a superseding update aborts the first one
- override deepmerge-ts to clear GHSA-ggr8-5vv4-36mx

### Documentation

- **demo-vault:** give the demo vault its code buttons
- capture the community-store screenshot set
- retire the finished rewrite plan and use NATO placeholders

## 3.4.3

This release has 1 new feature and 1 documentation change.

### New

- **demo-vault:** migrate to `obsidian-dev-utils` 93.3.1 and adopt the authoring convention

### Documentation

- make the demo vault the documentation, in the standard layout

## 3.4.2

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.4.1

This release has 1 fix. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- await the settings and ignore-pattern loads before the components that read them

## 3.4.0

This release has 1 documentation change. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Documentation

- fix the demo vault download instructions

## 3.3.2

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.3.1

This release has 1 improvement.

### Improved

- **enable:** fast-enable big vaults from the persisted hidden set re #10

## 3.3.0

This release has 1 new feature and 1 fix.

### New

- restore the index instantly on disable re #10

### Fixed

- remove duplicate plugin name from the progress notice

## 3.2.0

This release has 1 fix.

### Fixed

- \[FR\] Add option to hide empty directories (#11)

## 3.1.5

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 3.1.4

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **demo-vault:** export invoke() from startup script; add Invocables folder

## 3.1.3

This release has 4 documentation changes.

### Documentation

- standardize demo-vault README
- drop per-plugin demo-vault setup notes (bootstrap covered by the `obsidian-dev-utils` harness)
- unnumber demo-vault setup notes
- **demo-vault:** create the `Advanced Exclude` demo vault

## 3.1.2

This release has 1 fix.

### Fixed

- \[BUG\] Negation doesn't seem to work in .obsidianignore (#8)

## 3.1.1

This release has maintenance changes only. 10 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 3.1.0

This release has 1 improvement.

### Improved

- improve performance

## 3.0.0

This release has 1 improvement. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Improved

- improve performance

## 2.1.5

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.1.4

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.1.3

This release has maintenance changes only. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 2.1.2

This release has maintenance changes only. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 2.1.1

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.1.0

This release has 1 new feature. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add command handler with open-settings command

## 2.0.23

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.22

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.21

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.20

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.19

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.18

This release has maintenance changes only. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 2.0.17

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- build

## 2.0.16

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 2.0.15

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.14

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.13

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.12

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.11

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.10

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.9

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.8

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.7

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.6

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.5

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.4

This release has 1 other change.

### Other changes

- Ensure excluded items don't reappear on view reload

## 2.0.3

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.2

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.1

This release has 1 other change.

### Other changes

- Minor changes

## 2.0.0

This release has 4 other changes.

### Other changes

- Cache in database
- Prevent double load
- Add support for dir/ patterns
- Wait for metadata ready

## 1.3.0

This release has 1 other change.

### Other changes

- Add ExcludeMode

## 1.2.5

This release has 1 other change.

### Other changes

- Stop loop on plugin unload

## 1.2.4

This release has 1 other change.

### Other changes

- Minor changes

## 1.2.3

This release has 1 other change.

### Other changes

- Minor changes

## 1.2.2

This release has 1 other change.

### Other changes

- Minor changes

## 1.2.1

This release has 1 other change.

### Other changes

- New template

## 1.2.0

This release has 2 other changes.

### Other changes

- Show single progress bar
- Avoid extra count

## 1.1.0

This release has 3 other changes.

### Other changes

- Speed up on desktop
- Add progress bar
- Evaluate after load

## 1.0.1

This release has 2 other changes.

### Other changes

- Add warning
- Change default

## 1.0.0

This release has 1 other change.

### Other changes

- Initial release
