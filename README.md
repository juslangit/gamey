# Gamey

Make web games by chatting with Claude Code, and watch them being built live.

Chat and code on the left; on the right the game itself, running. As Claude works, each
object pops into the preview the moment it is placed, moved objects glide, removed ones
shrink away, new pictures land on the build feed, and saved scripts swap into the running
game without a restart. 2D games run on Phaser 3, 3D games on Three.js. Every game is a
plain folder in `~/Documents/Gamey/<name>/` that runs anywhere and publishes to itch.io.

## Run

```bash
npm install        # also copies Phaser and Three.js into runtime/
npm start
```

Needs Claude Code (`claude`) installed and signed in. Publishing needs
[butler](https://itch.io/docs/butler/) logged in.

## Build the Mac app

```bash
npm run dist       # electron-builder, then tools/sign.sh signs it and installs /Applications/Gamey.app
```

## How it fits together

- `main.js` — window, games, file watcher, Claude's tools, hidden test-play window, itch.io publish.
- `src/scene.js` — scene.json store; diffs every change into live steps.
- `src/claude.js` — the hidden Claude Code session and its instructions.
- `src/mcp-server.js` — Gamey's MCP tools (scene_*, asset_download, screenshot, test_play, game_errors).
- `src/server.js` — preview server: game files, live steps (SSE), error reports, tool calls.
- `runtime/` — the game runtime copied into every game: `core.js`, `engine2d.js`, `engine3d.js`.
- `renderer/` — the app's UI.
