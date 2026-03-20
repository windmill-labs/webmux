import SwiftUI

@main
struct WebmuxMacOSApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var connectionsStore = ConnectionsStore()
    @StateObject private var worktreeStore = WorktreeStore()

    var body: some Scene {
        WindowGroup("webmux") {
            ContentView(
                connectionsStore: connectionsStore,
                store: worktreeStore
            )
                .task(id: connectionsStore.selectedConnection) {
                    await worktreeStore.selectConnection(connectionsStore.selectedConnection)
                }
                .frame(minWidth: 980, minHeight: 620)
        }
        .defaultSize(width: 1180, height: 760)
    }
}
