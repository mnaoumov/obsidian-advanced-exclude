# Profiles

A **profile** is a named set of patterns and settings you can switch to in one click: a `Focus` profile that hides everything but today's work, a `Presenting` profile that hides private folders, and so on.

## Each device picks its own profile

The profiles themselves are stored in the plugin's `data.json`, so they sync with the vault. Which one is **active** is not: each device keeps its own choice, so your laptop can show everything while your phone stays in `Focus`.

When no profile is active, the **base settings** apply - the ignore patterns and toggles at the top of the settings tab, the ones [01 Exclude a folder](<./01 Exclude a folder.md>) to [04 Settings](<./04 Settings.md>) describe. A profile starts from them and overrides only what it sets.

Switch profiles from the `Exclude:` item in the status bar, or with the **`Advanced Exclude`: Switch profile...** and **`Advanced Exclude`: Use base settings** commands. The status-bar item appears once a profile exists.

```code-button
---
caption: Create the demo profiles
---
await require('/demoSetup.ts').createDemoProfiles(app);
```

This creates two profiles:

- `Hide archive`, with the single pattern `Archive/`.
- `Focus`, whose patterns are `@import Hide archive` followed by `Shared/`.

```code-button
---
caption: Activate "Hide archive"
---
await require('/demoSetup.ts').activateProfile(app, 'demo-hide-archive');
```

```code-button
---
caption: Activate "Focus"
---
await require('/demoSetup.ts').activateProfile(app, 'demo-focus');
```

```code-button
---
caption: Back to the base settings
---
await require('/demoSetup.ts').activateProfile(app, null);
```

Manual equivalent: click `Exclude:` in the status bar and pick the profile.

## Compose profiles with `@import`

A line `@import <profile name>` pastes another profile's patterns at that line. `Focus` above hides `Archive/` through its import, then `Shared/` by its own line.

Order matters, exactly as in one `.gitignore`: the lines are read top to bottom, so a later `!negation` can re-include what an earlier line or import hid. A profile can import several others and mix them with its own lines:

```gitignore
@import Alpha
@import Beta
drafts/*
!drafts/keep.md
@import Gamma
```

- **`@reset`** on a line of its own drops everything collected before it, the base patterns included, and returns every setting to its default. Use it for a profile that should not inherit the base settings.
- **`\@`** starts a pattern that really begins with `@`, the same way `\#` does for `#`.
- A profile's own settings beat the ones it imports, and of two imports the later one wins.
- Renaming a profile rewrites the `@import` lines that name it.

## Import a file with `@import file:`

A line `@import file:<vault path>` pastes the patterns of a file in the vault at that line, the same way. `@import file:.gitignore` puts the vault's `.gitignore` exactly where you want it in a profile, which the **Include .gitignore patterns** setting cannot: that one always adds it after every other line.

- The path is relative to the vault root, and the file may be one the plugin hides, or a dot file such as `.gitignore`.
- The file's lines are taken literally, as in a `.gitignore`: a line starting with `@` in it is a pattern, not a directive, so a file cannot import anything.
- Editing the file applies at once, while the plugin runs. `@import file:.obsidianignore` reads a `.obsidianignore` that way, without the **Include `.obsidianignore` patterns** setting.
- A profile cannot be named starting with `file:`, since `@import file:...` would read as a file.

Mistakes are reported, never silently dropped: the profile editor lists an unknown profile name, a file that does not exist, an import cycle (`Alpha` imports `Beta`, which imports `Alpha`) and an import chain nested too deep, with the profile and line of each. The editor also shows the full expansion, each line labelled with the profile it came from, and with the file for a line a file import pasted.

## Clean up

```code-button
---
caption: Remove the demo profiles
---
await require('/demoSetup.ts').removeDemoProfiles(app);
```
