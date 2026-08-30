import AppKit

final class GhosttyWindowObserverController {
    private var observers: [NSObjectProtocol] = []

    func configure(
        for window: NSWindow?,
        onDidBecomeKey: @escaping @MainActor @Sendable () -> Void,
        onDidResignKey: @escaping @MainActor @Sendable () -> Void,
        onDidChangeScreen: @escaping @MainActor @Sendable () -> Void
    ) {
        removeAll()

        guard let window else { return }
        let center = NotificationCenter.default

        observers.append(center.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: window,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                onDidBecomeKey()
            }
        })
        observers.append(center.addObserver(
            forName: NSWindow.didResignKeyNotification,
            object: window,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                onDidResignKey()
            }
        })
        observers.append(center.addObserver(
            forName: NSWindow.didChangeScreenNotification,
            object: window,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                onDidChangeScreen()
            }
        })
    }

    func removeAll() {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers.removeAll()
    }
}
