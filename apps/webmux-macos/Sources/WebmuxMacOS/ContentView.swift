import SwiftUI

struct ContentView: View {
    @ObservedObject var connectionsStore: ConnectionsStore
    @ObservedObject var store: WorktreeStore

    @State private var projectsDialogPresented = false
    @State private var worktreePendingRemovalBranch: String?
    @State private var worktreePendingMergeBranch: String?

    var body: some View {
        Group {
            if connectionsStore.connections.isEmpty {
                emptyStateView
            } else {
                NavigationSplitView {
                    WorktreeSidebarView(
                        title: selectedConnectionName,
                        worktrees: store.worktrees,
                        selection: selectedBranchBinding,
                        canCreateWorktree: connectionsStore.selectedConnection != nil,
                        canRefresh: !store.isLoading && !store.isConnecting && connectionsStore.selectedConnection != nil,
                        onCreateWorktree: {
                            store.createSheetPresented = true
                        },
                        onRefresh: {
                            Task {
                                await store.reload()
                            }
                        },
                        onOpenWorktree: { branch in
                            store.selectBranch(branch)
                            Task {
                                await store.openWorktree(named: branch)
                            }
                        },
                        onCloseWorktree: { branch in
                            store.selectBranch(branch)
                            Task {
                                await store.closeWorktree(named: branch)
                            }
                        },
                        onMergeWorktree: { branch in
                            presentMergeConfirmation(for: branch)
                        },
                        onRemoveWorktree: { branch in
                            presentRemoveConfirmation(for: branch)
                        }
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
                onManageProjects: {
                    projectsDialogPresented = true
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
        .sheet(isPresented: $projectsDialogPresented) {
            ProjectsDialog(connectionsStore: connectionsStore)
        }
        .alert("webmux", isPresented: alertPresented) {
            Button("OK", role: .cancel) {
                store.alertMessage = nil
            }
        } message: {
            Text(verbatim: store.alertMessage ?? "")
        }
        .confirmationDialog(
            "Remove Worktree?",
            isPresented: worktreeRemovalPresented
        ) {
            Button("Remove", role: .destructive) {
                if let worktreePendingRemovalBranch {
                    Task {
                        await store.removeWorktree(named: worktreePendingRemovalBranch)
                    }
                    self.worktreePendingRemovalBranch = nil
                }
            }
        } message: {
            Text(verbatim: "Remove worktree \"\(worktreePendingRemovalBranch ?? "")\"? This action cannot be undone.")
        }
        .confirmationDialog(
            "Merge Worktree?",
            isPresented: worktreeMergePresented
        ) {
            Button("Merge", role: .destructive) {
                if let worktreePendingMergeBranch {
                    Task {
                        await store.mergeWorktree(named: worktreePendingMergeBranch)
                    }
                    self.worktreePendingMergeBranch = nil
                }
            }
        } message: {
            Text(verbatim: "Merge worktree \"\(worktreePendingMergeBranch ?? "")\" into main? The worktree will be removed after merging.")
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
                projectsDialogPresented = true
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
            onMergeWorktree: {
                if let selectedBranch = store.selectedBranch {
                    presentMergeConfirmation(for: selectedBranch)
                }
            },
            onRemoveWorktree: {
                if let selectedBranch = store.selectedBranch {
                    presentRemoveConfirmation(for: selectedBranch)
                }
            },
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

    private var worktreeRemovalPresented: Binding<Bool> {
        Binding(
            get: { worktreePendingRemovalBranch != nil },
            set: { newValue in
                if !newValue {
                    worktreePendingRemovalBranch = nil
                }
            }
        )
    }

    private var worktreeMergePresented: Binding<Bool> {
        Binding(
            get: { worktreePendingMergeBranch != nil },
            set: { newValue in
                if !newValue {
                    worktreePendingMergeBranch = nil
                }
            }
        )
    }

    private func presentMergeConfirmation(for branch: String) {
        store.selectBranch(branch)
        worktreePendingMergeBranch = branch
    }

    private func presentRemoveConfirmation(for branch: String) {
        store.selectBranch(branch)
        worktreePendingRemovalBranch = branch
    }
}
