import SwiftUI

struct ContentView: View {
    @ObservedObject var connectionsStore: ConnectionsStore
    @ObservedObject var store: WorktreeStore

    @State private var editingConnection: ConnectionProfile?
    @State private var connectionPendingRemoval: ConnectionProfile?

    var body: some View {
        Group {
            if connectionsStore.connections.isEmpty {
                emptyStateView
            } else {
                NavigationSplitView {
                    WorktreeSidebarView(
                        title: selectedConnectionName,
                        worktrees: store.worktrees,
                        selection: selectedBranchBinding
                    )
                } detail: {
                    detailView
                }
            }
        }
        .toolbar {
            ProjectToolbar(
                connections: connectionsStore.connections,
                selectedConnectionID: $connectionsStore.selectedConnectionID,
                canEditSelectedConnection: connectionsStore.selectedConnection != nil,
                canCreateWorktree: connectionsStore.selectedConnection != nil,
                canRefresh: !store.isLoading && !store.isConnecting && connectionsStore.selectedConnection != nil,
                onAddConnection: {
                    connectionsStore.addSheetPresented = true
                },
                onEditConnection: {
                    editingConnection = connectionsStore.selectedConnection
                },
                onRemoveConnection: {
                    connectionPendingRemoval = connectionsStore.selectedConnection
                },
                onCreateWorktree: {
                    store.createSheetPresented = true
                },
                onRefresh: {
                    Task {
                        await store.reload()
                    }
                }
            )
        }
        .overlay {
            if store.isConnecting {
                ProgressView("Connecting to webmux backend…")
                    .padding(20)
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .sheet(isPresented: $store.createSheetPresented) {
            CreateWorktreeSheet { mode, branch in
                await store.createWorktree(mode: mode, branch: branch)
            }
        }
        .sheet(isPresented: $connectionsStore.addSheetPresented) {
            AddConnectionSheet(connectionsStore: connectionsStore)
        }
        .sheet(item: $editingConnection) { connection in
            AddConnectionSheet(
                connectionsStore: connectionsStore,
                editingConnection: connection
            )
        }
        .alert("webmux", isPresented: alertPresented) {
            Button("OK", role: .cancel) {
                store.alertMessage = nil
            }
        } message: {
            Text(verbatim: store.alertMessage ?? "")
        }
        .confirmationDialog(
            "Remove Project?",
            isPresented: connectionRemovalPresented
        ) {
            Button("Remove", role: .destructive) {
                if let connectionPendingRemoval {
                    connectionsStore.removeConnection(connectionPendingRemoval)
                    self.connectionPendingRemoval = nil
                }
            }
        } message: {
            Text(verbatim: "This will remove the saved connection for \(connectionPendingRemoval?.name ?? "this project").")
        }
    }

    private var selectedConnectionName: String {
        connectionsStore.selectedConnection?.name ?? store.project?.name ?? "webmux"
    }

    private var selectedBranchBinding: Binding<String?> {
        Binding(
            get: { store.selectedBranch },
            set: { store.selectBranch($0) }
        )
    }

    private var emptyStateView: some View {
        ContentUnavailableView {
            Label("No Projects Added", systemImage: "server.rack")
        } description: {
            Text("Add a webmux server to load worktrees and attach terminals.")
        } actions: {
            Button("Add Project") {
                connectionsStore.addSheetPresented = true
            }
        }
    }

    @ViewBuilder
    private var detailView: some View {
        WorktreeDetailView(
            worktree: store.selectedWorktree,
            isResolvingTerminal: store.isResolvingTerminal,
            terminalSession: store.terminalSession,
            terminalMessage: store.terminalMessage,
            onOpenWorktree: {
                Task {
                    await store.openSelectedWorktree()
                }
            },
            onCloseWorktree: {
                Task {
                    await store.closeSelectedWorktree()
                }
            }
        )
    }

    private var alertPresented: Binding<Bool> {
        Binding(
            get: { store.alertMessage != nil },
            set: { newValue in
                if !newValue {
                    store.alertMessage = nil
                }
            }
        )
    }

    private var connectionRemovalPresented: Binding<Bool> {
        Binding(
            get: { connectionPendingRemoval != nil },
            set: { newValue in
                if !newValue {
                    connectionPendingRemoval = nil
                }
            }
        )
    }
}
