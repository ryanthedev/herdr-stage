# herdr-stage

The full native test recipe is in `RESUME.md` ("How to test natively without touching the user's Herdr").

## Launching a test Herdr window

```sh
env -u CLAUDECODE -u CLAUDE_PID -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SESSION_ID \
    -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_CODE_ENTRYPOINT \
    -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u HC_TERMINAL_ID -u HC_SCOPE \
  open -g -n -a Herdr --env HERDR_APP_HOME=$HOME/.cache/hst
```

- **Never launch a Herdr window (test or main) from a Claude shell without that `env -u`.** The window inherits the shell's environment and hands it to every terminal it starts. A Claude started there inherits `CLAUDE_CODE_CHILD_SESSION=1`, prints "Transcript saving is off", and can't be resumed. This was seen 2026-11-08 on t4t and t4v, and on the main window after a relaunch from a Claude shell.
- **Pass `HERDR_APP_HOME` explicitly** to `herdr-app` and `scripts/install.sh`. This shell may have inherited another session's test home.
- **Every Herdr window shares one herdr-core and its layout.** `tab.new` or `pane.split` in a "test" window lands in the person's real spaces, so test through a layout block instead.
