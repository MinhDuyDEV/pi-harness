---
name: swiftui-expert-skill
description: SwiftUI architecture and API guidance — state management with @State and @Observable, view composition, NavigationStack, performance, modern iOS 17+ APIs, and iOS 26 Liquid Glass. User-invoked; load via /skill:swiftui-expert-skill when building or refactoring SwiftUI views, choosing state wrappers, or adopting modern SwiftUI patterns.
metadata:
  version: 1.0.0
  tags:
  - apple
  - ui
  dependencies: []
disable-model-invocation: true
---

# SwiftUI Expert

## Iron Laws

<EXTREMELY-IMPORTANT>
- **State drives the view.** `@State` local; `@Observable` shared. Never mutate from views.
- **View = function of state.** Same input, same view. No hidden state.
- **Compose small views, not modifiers.** `VStack` of named views > 20-line modifier chain.
- **Pass values, not view models.** Child takes `User`, not a fetching wrapper.
- **Test the state, not the view.** Snapshot tests are flaky.
</EXTREMELY-IMPORTANT>

## State Management

| Type | Scope | When |
|---|---|---|
| `@State` | Local view | Form input, toggle, scroll |
| `@Binding` | Two-way parent ↔ child | Parent-controlled inputs |
| `@Observable` | Shared model | View model, store, repository |
| `@Environment` | Injected | Theme, router, current user |
| `@Query` (SwiftData) | Persistent | Database rows |
| `@FetchRequest` (Core Data) | Persistent | Legacy |

`@Observable` (iOS 17+) replaces `ObservableObject`. Use it for new code.

## View Composition

```swift
struct UserListView: View {
    let users: [User]
    var body: some View {
        List(users) { user in
            UserRow(user: user)
        }
    }
}

struct UserRow: View {
    let user: User
    var body: some View {
        HStack {
            Avatar(url: user.avatarURL)
            VStack(alignment: .leading) {
                Text(user.name)
                Text(user.email).foregroundStyle(.secondary)
            }
        }
    }
}
```

Small, named views. The parent passes values, the child renders. Easy to test, easy to preview.

## Modern APIs (iOS 17+)

- `@Observable` for view models
- `.scrollPosition(id:)` for scroll control
- `Animation.smooth` / `bouncy` for natural motion
- `.inspector` for trailing panels
- `.containerRelativeFrame` for adaptive layout
- `ContentUnavailableView` for empty/error states
- `ImageRenderer` for view → image

## iOS 26+ Liquid Glass

- `.glassEffect()` for surface treatments (`.regular` / `.prominent`, tint, `.interactive()`)
- `GlassEffectContainer` for grouped glass elements
- `.buttonStyle(.glass)` / `.buttonStyle(.glassProminent)` for buttons
- Requires iOS 26+; provide a materials fallback via `if #available(iOS 26, *)`

## Performance

- No expensive work in `body`. Compute outside, store in `@State`.
- `LazyVStack` / `LazyHStack` for long lists.
- `equatable()` on views to skip re-renders.
- For large collections, use `Identified` arrays.
- Profile with Instruments → SwiftUI template.

## Navigation

- `NavigationStack` (value-based) for new code.
- `NavigationPath` for programmatic nav.
- `navigationDestination(for:)` for type-safe routing.
- Avoid `NavigationView` (deprecated).

## Forms

```swift
struct SettingsView: View {
    @State private var name = ""
    @State private var enableNotifications = true
    var body: some View {
        Form {
            Section("Profile") {
                TextField("Name", text: $name)
                Toggle("Notifications", isOn: $enableNotifications)
            }
        }
    }
}
```

`Form` for input. `List` for selection.

## References

Deep dives in `references/`: `state-management.md`, `view-structure.md`, `layout-best-practices.md`, `list-patterns.md`, `scroll-patterns.md`, `sheet-navigation-patterns.md`, `modern-apis.md`, `animation-basics.md`, `animation-transitions.md`, `animation-advanced.md`, `performance-patterns.md`, `image-optimization.md`, `text-formatting.md`, `liquid-glass.md` (iOS 26). Load the matching file before answering non-trivial questions in that area.

## Red Flags

`@State` for shared state; `@StateObject`/`ObservableObject` in new iOS 17+ code; `GeometryReader` for simple layout or centering; force unwraps; side effects or I/O in `body`; `onAppear` for work that belongs in `.task`; `NavigationView` (deprecated); 20-line modifier chains instead of named subviews; views that own their network calls; no previews; testing the view instead of the model.
