import Foundation

@MainActor
final class WorktreeStore: ObservableObject {
    @Published private(set) var project: ProjectSnapshot.Project?
    @Published private(set) var worktrees: [WorktreeSnapshot] = []
    @Published var selectedBranch: String? {
        didSet {
            guard !suppressSelectionResolution else { return }
            Task {
                await resolveTerminalForSelection()
            }
        }
    }
    @Published var createSheetPresented = false
    @Published var alertMessage: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isConnecting = false
    @Published private(set) var isResolvingTerminal = false
    @Published private(set) var terminalSession: TerminalSessionDescriptor?
    @Published private(set) var terminalMessage: String?

    private var connection: (any WebmuxConnection)?
    private var suppressSelectionResolution = false

    init() {}

    var selectedWorktree: WorktreeSnapshot? {
        guard let selectedBranch else { return nil }
        return worktrees.first(where: { $0.branch == selectedBranch })
    }

    func reload() async {
        guard let client = connection?.client else { return }

        do {
            isLoading = true
            let snapshot = try await client.fetchProject()
            project = snapshot.project
            worktrees = snapshot.worktrees
            if selectedBranch == nil {
                selectedBranch = snapshot.worktrees.first?.branch
            } else if !snapshot.worktrees.contains(where: { $0.branch == selectedBranch }) {
                selectedBranch = snapshot.worktrees.first?.branch
            }
            isLoading = false
            await resolveTerminalForSelection()
        } catch {
            isLoading = false
            alertMessage = error.localizedDescription
        }
    }

    func createWorktree(mode: CreateWorktreeMode, branch: String?) async {
        guard let client = connection?.client else { return }

        do {
            let created = try await client.createWorktree(mode: mode, branch: branch)
            await reload()
            selectedBranch = created.branch
            createSheetPresented = false
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func openSelectedWorktree() async {
        guard let selectedBranch,
              let client = connection?.client else { return }

        do {
            try await client.openWorktree(named: selectedBranch)
            await reload()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func closeSelectedWorktree() async {
        guard let selectedBranch,
              let client = connection?.client else { return }

        do {
            try await client.closeWorktree(named: selectedBranch)
            await reload()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func resolveTerminalForSelection() async {
        guard let selectedWorktree else {
            terminalSession = nil
            terminalMessage = nil
            return
        }

        guard selectedWorktree.mux else {
            terminalSession = nil
            terminalMessage = "Open this worktree to attach the terminal."
            return
        }

        guard let connection else { return }

        do {
            isResolvingTerminal = true
            let launch = try await connection.client.fetchTerminalLaunch(named: selectedWorktree.branch)
            terminalSession = connection.makeTerminalSession(for: launch)
            terminalMessage = nil
            isResolvingTerminal = false
        } catch let error as BackendError {
            isResolvingTerminal = false
            terminalSession = nil
            switch error {
            case .requestFailed(let status, let message) where status == 409:
                terminalMessage = message
            default:
                terminalMessage = error.localizedDescription
            }
        } catch {
            isResolvingTerminal = false
            terminalSession = nil
            terminalMessage = error.localizedDescription
        }
    }

    func selectConnection(_ profile: ConnectionProfile?) async {
        if connection?.profile == profile {
            return
        }

        if let connection {
            await connection.stop()
        }

        clearState()

        guard let profile else { return }

        let connection = WebmuxConnectionFactory.make(profile: profile)
        self.connection = connection

        do {
            isConnecting = true
            try await connection.start()
            isConnecting = false
            await reload()
        } catch {
            isConnecting = false
            alertMessage = error.localizedDescription
        }
    }

    private func clearState() {
        connection = nil
        project = nil
        worktrees = []
        suppressSelectionResolution = true
        selectedBranch = nil
        suppressSelectionResolution = false
        terminalSession = nil
        terminalMessage = nil
        alertMessage = nil
        isLoading = false
        isResolvingTerminal = false
        isConnecting = false
    }
}
