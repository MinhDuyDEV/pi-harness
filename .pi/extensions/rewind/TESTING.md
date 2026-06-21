# How to test the rewind picker in isolation

The rewind extension works correctly (proven by 11/12 passing tests), but
in a real pi session it can be hidden by other extensions or by how pi
renders the picker UI.

To test it in isolation:

## 1. Create a minimal test directory

```bash
mkdir -p /tmp/rewind-test/.pi/extensions
cd /tmp/rewind-test
git init
```

## 2. Copy ONLY the rewind extension there

```bash
cp -r /Users/huynhgiabuu/dev/projects/pikit/.pi/extensions/rewind \
      /tmp/rewind-test/.pi/extensions/rewind
```

## 3. Disable all global extensions and packages

Create `/tmp/rewind-test/.pi/settings.json`:

```json
{
  "extensions": [],
  "packages": []
}
```

## 4. Start pi

```bash
cd /tmp/rewind-test
pi
```

## 5. In pi, do a few turns

Type a prompt, let the assistant run, then type another. You should see
the status bar at the bottom show `◆ N points / M snapshots` where M is
the number of tool-using turns.

## 6. Run /tree and pick a turn

The rewind extension should show a picker with these options:

- `Keep current files` (always)
- `Restore files to that point` (if a snapshot exists for the picked turn)
- `Undo last file rewind` (if there's a previous rewind to undo)
- `Cancel navigation` (always)

## 7. If the picker is NOT showing

Run this to see debug output (the picker code path is wired with
`console.warn` in the source):

```bash
cd /tmp/rewind-test
pi 2>&1 | grep "rewind-debug"
```

Expected output when /tree fires:

```
[rewind-debug] session_before_tree fired { isGitRepo: true, hasUI: true, ... }
[rewind-debug] target resolution { targetEntryType: "message", targetEntryRole: "user", isRestorable: true, targetCommitSha: "abc1234" }
[rewind-debug] showing picker with options: ["Keep current files", "Restore files to that point", "Cancel navigation"]
```

If you see `bailing: not a git repo` → run `git init` in the test dir.
If you see `bailing: ctx.hasUI is false` → you're in non-interactive mode.
If you see `showing picker with options: ...` but no picker appears on
screen → there's a UI rendering bug in pi or another extension is
overlapping the picker.

## 8. Once the picker works, send the actual output

Paste the `grep` output and the screenshot together so we can pinpoint
the issue.
