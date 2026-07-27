# Browser runtime evidence and tool routing

Static compilation does not prove browser behavior. Define the user-visible
behavior, start the app, run the lightest repeatable tool, and record the
evidence.

| Need | Tool |
|---|---|
| repeatable cross-browser flows and screenshots | `playwright` |
| live Chrome console/network/runtime inspection | `chrome-devtools` |
| static extraction | `web_fetch` |
| implementation guidance | `frontend-design` |

Capture an initial URL/DOM or screenshot and relevant console/network baseline.
Exercise one user intent with role/label locators and condition-based waits.
Capture final DOM, screenshot, response status, console output, or trace. Never
replace a missing assertion with an arbitrary sleep. If a browser-only defect
appears, hand off with exact reproduction steps, browser/device, and the
captured evidence.

