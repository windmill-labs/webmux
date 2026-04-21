import Foundation

@MainActor
final class WorktreeStore: ObservableObject {
    @Published private(set) var project: ProjectSnapshot.Project?
    @Published private(set) var worktrees: [WorktreeSnapshot] = []
    @Published private(set) var selectedBranch: String?
    @Published var createSheetPresented = false
    @Published var alertMessage: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isConnecting = false
    @Published private(set) var isResolvingTerminal = false
    @Published private(set) var terminalSession: TerminalSessionDescriptor?
    @Published private(set) var terminalMessage: String?

    private var connection: (any WebmuxConnection)?
    private var terminalResolutionTask: Task<Void, Never>?
    private var terminalSessionCache: [String: TerminalSessionDescriptor] = [:]

    init() {}

    var selectedWorktree: WorktreeSnapshot? {
        guard let selectedBranch else { return nil }
        return worktrees.first(where: { $0.branch == selectedBranch })
    }

    func selectBranch(_ branch: String?) {
        guard selectedBranch != branch else { return }
        selectedBranch = branch
        scheduleTerminalResolution()
    }

    func reload(selecting preferredBranch: String? = nil) async {
        guard let client = connection?.client else { return }

        do {
            isLoading = true
            let snapshot = try await client.fetchProject()
            isLoading = false
            applyProjectSnapshot(snapshot, preferredSelection: preferredBranch)
        } catch {
            isLoading = false
            alertMessage = error.localizedDescription
        }
    }

    func createWorktree(mode: CreateWorktreeMode, branch: String?) async {
        guard let client = connection?.client else { return }

        do {
            let created = try await client.createWorktree(mode: mode, branch: branch)
            await reload(selecting: created.branch)
            createSheetPresented = false
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func openSelectedWorktree() async {
        guard let selectedBranch else { return }
        await openWorktree(named: selectedBranch)
    }

    func closeSelectedWorktree() async {
        guard let selectedBranch else { return }
        await closeWorktree(named: selectedBranch)
    }

    func mergeSelectedWorktree() async {
        guard let selectedBranch else { return }
        await mergeWorktree(named: selectedBranch)
    }

    func removeSelectedWorktree() async {
        guard let selectedBranch else { return }
        await removeWorktree(named: selectedBranch)
    }

    func selectConnection(_ profile: ConnectionProfile?) async {
        if connection?.profile == profile {
            return
        }

        clearState()

        guard let profile else { return }

        let connection = WebmuxConnectionFactory.make(profile: profile)
        self.connection = connection

        do {
            isConnecting = true
            let snapshot = try await connection.client.fetchProject()
            isConnecting = false
            applyProjectSnapshot(snapshot)
        } catch {
            isConnecting = false
            self.connection = nil
            alertMessage = error.localizedDescription
        }
    }

    func openWorktree(named branch: String) async {
        guard let client = connection?.client else { return }

        do {
            try await client.openWorktree(named: branch)
            await reload(selecting: branch)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func closeWorktree(named branch: String) async {
        guard let client = connection?.client else { return }

        do {
            try await client.closeWorktree(named: branch)
            await reload(selecting: branch)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func mergeWorktree(named branch: String) async {
        guard let client = connection?.client else { return }

        do {
            try await client.mergeWorktree(named: branch)
            await reload()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func removeWorktree(named branch: String) async {
        guard let client = connection?.client else { return }

        do {
            try await client.removeWorktree(named: branch)
            await reload()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func applyProjectSnapshot(
        _ snapshot: ProjectSnapshot,
        preferredSelection: String? = nil
    ) {
        project = snapshot.project
        worktrees = snapshot.worktrees
        let openBranches = Set(snapshot.worktrees.filter(\.mux).map(\.branch))
        terminalSessionCache = terminalSessionCache.filter { openBranches.contains($0.key) }
        selectedBranch = resolvedSelection(
            in: snapshot.worktrees,
            preferredSelection: preferredSelection
        )
        scheduleTerminalResolution()
    }

    private func resolvedSelection(
        in worktrees: [WorktreeSnapshot],
        preferredSelection: String?
    ) -> String? {
        if let preferredSelection,
           worktrees.contains(where: { $0.branch == preferredSelection }) {
            return preferredSelection
        }

        if let selectedBranch,
           worktrees.contains(where: { $0.branch == selectedBranch }) {
            return selectedBranch
        }

        return worktrees.first?.branch
    }

    private func scheduleTerminalResolution() {
        cancelTerminalResolution()

        guard let selectedWorktree else {
            terminalSession = nil
            terminalMessage = nil
            isResolvingTerminal = false
            return
        }

        guard selectedWorktree.mux else {
            terminalSession = nil
            terminalMessage = "Open this worktree to attach the terminal."
            isResolvingTerminal = false
            return
        }

        guard let connection else {
            terminalSession = nil
            terminalMessage = nil
            isResolvingTerminal = false
            return
        }

        let branch = selectedWorktree.branch
        let profile = connection.profile

        if let cachedSession = terminalSessionCache[branch] {
            terminalSession = cachedSession
            terminalMessage = nil
            isResolvingTerminal = false
            return
        }

        isResolvingTerminal = true
        terminalSession = nil
        terminalMessage = nil

        terminalResolutionTask = Task { @MainActor [weak self] in
            do {
                let launch = try await connection.client.fetchTerminalLaunch(named: branch)
                guard let self,
                      !Task.isCancelled,
                      self.connection?.profile == profile,
                      self.selectedBranch == branch else {
                    return
                }

                let session = connection.makeTerminalSession(for: launch)
                terminalSessionCache[branch] = session
                terminalSession = session
                terminalMessage = nil
                isResolvingTerminal = false
                terminalResolutionTask = nil
            } catch is CancellationError {
                return
            } catch let error as BackendError {
                guard let self,
                      !Task.isCancelled,
                      self.connection?.profile == profile,
                      self.selectedBranch == branch else {
                    return
                }

                isResolvingTerminal = false
                terminalSession = nil
                terminalSessionCache.removeValue(forKey: branch)
                switch error {
                case .requestFailed(let status, let message) where status == 409:
                    terminalMessage = message
                default:
                    terminalMessage = error.localizedDescription
                }
                terminalResolutionTask = nil
            } catch {
                guard let self,
                      !Task.isCancelled,
                      self.connection?.profile == profile,
                      self.selectedBranch == branch else {
                    return
                }

                isResolvingTerminal = false
                terminalSession = nil
                terminalSessionCache.removeValue(forKey: branch)
                terminalMessage = error.localizedDescription
                terminalResolutionTask = nil
            }
        }
    }

    private func cancelTerminalResolution() {
        terminalResolutionTask?.cancel()
        terminalResolutionTask = nil
    }

    private func clearState() {
        cancelTerminalResolution()
        connection = nil
        project = nil
        worktrees = []
        selectedBranch = nil
        terminalSession = nil
        terminalMessage = nil
        terminalSessionCache = [:]
        alertMessage = nil
        isLoading = false
        isResolvingTerminal = false
        isConnecting = false
    }
}
