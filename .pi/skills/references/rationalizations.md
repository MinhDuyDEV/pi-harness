# Common Agent Rationalizations

Use these when writing or applying skills. Add local rebuttals when a skill has more specific failure modes.

| Rationalization | Rebuttal |
| --- | --- |
| "I'll verify later" | Later means after context has drifted. Verify before claiming progress. |
| "The subagent said it is done" | Subagents report intent, not truth. Inspect files and run checks. |
| "This is too small to test" | Small changes still break behavior. Choose proportionate verification, not zero verification. |
| "No tests exist" | Add the smallest regression or characterization test, or explicitly report why tests are impossible. |
| "I already understand the file" | Read the current file. The worktree may have changed. |
| "The plan says it, so it must be true" | Plans are hypotheses. Verify against current code before editing. |
| "I can clean this up while I'm here" | Mixed-scope changes hide bugs and make review harder. Create a follow-up task instead. |
| "The build should pass" | `should` is not evidence. Run the command or state that it was not run. |
| "The user wants speed" | False completion wastes more time than disciplined verification. |
