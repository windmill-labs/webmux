# Mobile Ideas

Checked against upstream docs on March 18, 2026.

## Summary

There are two realistic directions:

- keep the current Svelte app and improve the mobile shell around it
- build a separate mobile app with its own interaction model

If mobile is becoming a core product and terminal quality matters, a separate mobile app is the stronger long-term bet.

## Current Web Constraint

The current browser terminal is `xterm.js` attached to `tmux`.

The key limitation is that `xterm.js` has separate normal and alternate buffers. In our mobile debugging, the terminal was often in the alternate buffer, which meant the browser viewport had no meaningful DOM scrollback to scroll. That is why mobile touch scrolling on the live terminal was unreliable.

Because of that, the current web implementation uses a separate mobile scroll path:

- `Interact` mode uses the live terminal
- `Scroll` mode uses a tmux-backed read-only snapshot view

This is not a universal requirement for mobile terminals. It is the pragmatic fix for this specific browser + xterm + tmux architecture.

## Option 1: Keep The Web App

### Capacitor

Capacitor is the best fit if we want to wrap the existing Svelte app as an installable iOS/Android app and add native APIs like notifications, filesystem access, and app lifecycle handling.

Recommendation:

- good if mobile is mostly a task, status, log, and notification surface
- not enough by itself if the terminal is the main product experience

Reason:

- the terminal still runs in a webview
- that means we still inherit browser terminal constraints

## Option 2: Build A Separate Mobile App

### Flutter + `xterm.dart`

This is the strongest option if mobile should be terminal-first.

Why it stands out:

- real cross-platform mobile UI
- terminal widget designed for mobile and desktop
- one shared codebase for Android and iOS
- avoids the browser/webview terminal interaction problems

Recommendation:

- best overall choice if terminal quality is central

### Expo / React Native

This is the strongest option if mobile should be task-first rather than terminal-first.

Why it stands out:

- mature native mobile ecosystem
- excellent support for push notifications, auth, secure storage, and app shell behavior
- strong gesture and animation libraries
- easier to build a polished mobile dashboard around worktrees, jobs, logs, PRs, and alerts

Recommendation:

- best choice if the mobile product should focus on workflows around the terminal
- less compelling if the core differentiator is a great interactive terminal

### SwiftUI + SwiftTerm

This is the strongest option if iOS quality matters most and we are willing to treat iOS separately.

Recommendation:

- good for a premium iPhone/iPad terminal experience
- not a complete cross-platform strategy on its own

### Kotlin Multiplatform

This is not the terminal solution by itself. It is a good architecture choice if we want:

- shared business logic
- shared API and sync logic
- native UI on both platforms

Recommendation:

- useful if we commit to fully separate native apps and want shared core logic

## Option I Would Not Bet On

### Svelte Native

I would not make this the main mobile strategy for a core product.

Reason:

- the ecosystem is smaller
- long-term confidence is weaker than Flutter, React Native, or fully native paths

## Recommendation

If we want the fastest acceptable mobile app:

- build a separate Expo / React Native app
- make it task-first
- treat the terminal as one feature, not the whole interaction model

If we want the best long-term terminal-centric mobile product:

- build a separate Flutter app
- use `xterm.dart`
- keep the web app for desktop and broad access

If we stay on the current web architecture for mobile:

- keep the snapshot-based `Scroll` mode
- do not keep investing in touch hacks for the live browser terminal

## Sources

- xterm.js buffer model: <https://xtermjs.org/docs/api/terminal/interfaces/ibuffernamespace/>
- Capacitor docs: <https://capacitorjs.com/docs>
- Expo docs: <https://docs.expo.dev/get-started/create-a-project/>
- React Native Gesture Handler docs: <https://docs.swmansion.com/react-native-gesture-handler/docs/>
- React Native Reanimated docs: <https://docs.swmansion.com/react-native-reanimated/>
- Flutter add-to-app docs: <https://docs.flutter.dev/add-to-app>
- `xterm.dart`: <https://pub.dev/packages/xterm>
- SwiftTerm: <https://github.com/migueldeicaza/SwiftTerm>
- Kotlin Multiplatform: <https://kotlinlang.org/multiplatform/>
- Svelte Native docs: <https://svelte.nativescript.org/docs/>
