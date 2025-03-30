# Advanced Exclude

This is a plugin for [Obsidian](https://obsidian.md/) that enhances the `Excluded files` setting bringing `gitignore` syntax.

Obsidian has `Files and links > Excluded files` setting, but it is not as useful, because the excluded files are still present in the `Files` pane, appear in `Backlinks` pane, etc.

The plugin adds the following features:

- Configure ignore patterns using [`gitignore`](https://git-scm.com/docs/gitignore) syntax.
- `.obsidianignore` file for manual editing.
- Support ignore patterns from `.gitignore` file.
- Reuse existing `Files and links > Excluded files` setting in string/regexp format.

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Make sure to have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Paste the following link in your browser and press `Enter`:

   ```
   obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-exclude
   ```

3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('advanced-exclude');
```

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils?tab=readme-ov-file#debugging).

## Support

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;"></a>

## License

© [Michael Naumov](https://github.com/mnaoumov/)
