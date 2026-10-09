---
name: skills-dashboard
description: Opens a local web dashboard for the user's Claude Code skills and plugins — enable/disable, install (GitHub or marketplace), delete, and see per-skill token cost and usage. Use when the user wants to see, manage, clean up, or cut the token cost of their skills or plugins.
---

# Skills Dashboard

A local web app (http://127.0.0.1:5179) that lists every skill and plugin Claude Code can load, with
toggles, installs, deletes, always-on token costs, and how often each skill was actually used.

## Launch

1. Start the server **in the background** (it keeps running and serving the page). Use this skill's
   base directory, shown above when the skill loads:

   ```bash
   node "<skill base dir>/scripts/server.mjs"
   ```

   - Needs Node 18+. If `node` is missing or fails to start, run the same script with `bun` instead.
   - It opens the browser itself. Add `--no-open` to skip that, or `--port <n>` for another port
     (it also moves to the next free port on its own).
   - If the dashboard is already running, the script just opens it and exits — that's expected.

2. Tell the user the URL it printed, and that changes (enabling, disabling, installing) apply to
   **new** Claude Code sessions, not the current one.

## Stop

Stop the background task you started, or:

```bash
pkill -f "skills-dashboard/scripts/server.mjs"
```

## Good to know

- Everything runs locally and listens on 127.0.0.1 only; nothing is sent anywhere.
- Plugin listing and toggles go through the `claude` CLI, so it must be on `PATH`.
- Disabled personal skills are moved to `~/.claude/skills-disabled`; deleted ones go to the Trash
  (`~/.claude/.skills-trash` on Linux/Windows), so both are recoverable.
- Usage counts come from the local session history in `~/.claude/projects`.
