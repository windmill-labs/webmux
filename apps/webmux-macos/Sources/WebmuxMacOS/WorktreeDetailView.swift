import SwiftUI

struct WorktreeDetailView: View {
    let worktree: WorktreeSnapshot?
    let isResolvingTerminal: Bool
    let terminalSession: TerminalSessionDescriptor?
    let terminalMessage: String?
    let onMergeWorktree: () -> Void
    let onRemoveWorktree: () -> Void
    let onOpenWorktree: () -> Void
    let onCloseWorktree: () -> Void

    var body: some View {
        Group {
            if let worktree {
                VStack(alignment: .leading, spacing: 0) {
                    WorktreeHeaderView(
                        worktree: worktree,
                        onMergeWorktree: onMergeWorktree,
                        onRemoveWorktree: onRemoveWorktree,
                        onOpenWorktree: onOpenWorktree,
                        onCloseWorktree: onCloseWorktree
                    )

                    TerminalPanelView(
                        isResolvingTerminal: isResolvingTerminal,
                        terminalSession: terminalSession,
                        terminalMessage: terminalMessage
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                ContentUnavailableView(
                    "No Worktree Selected",
                    systemImage: "sidebar.left",
                    description: Text("Choose a worktree from the sidebar.")
                )
            }
        }
    }
}

private struct WorktreeHeaderView: View {
    let worktree: WorktreeSnapshot
    let onMergeWorktree: () -> Void
    let onRemoveWorktree: () -> Void
    let onOpenWorktree: () -> Void
    let onCloseWorktree: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 16) {
                Text(verbatim: worktree.branch)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)

                Spacer(minLength: 0)

                HStack(spacing: 8) {
                    if worktree.mux {
                        Button("Close", action: onCloseWorktree)
                    } else {
                        Button("Open", action: onOpenWorktree)
                    }

                    Button("Merge", action: onMergeWorktree)
                    Button("Remove", role: .destructive, action: onRemoveWorktree)
                }
                .controlSize(.small)
            }

            if !worktree.prs.isEmpty || worktree.linearIssue != nil || !worktree.services.isEmpty {
                WrappingFlowLayout(spacing: 6, rowSpacing: 6) {
                    ForEach(worktree.prs, id: \.self) { pr in
                        PRBadgeView(pr: pr)
                    }

                    if let issue = worktree.linearIssue {
                        LinearBadgeView(issue: issue)
                    }

                    ForEach(worktree.services, id: \.self) { service in
                        ServiceBadgeView(service: service)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }
}

private struct TerminalPanelView: View {
    let isResolvingTerminal: Bool
    let terminalSession: TerminalSessionDescriptor?
    let terminalMessage: String?
    private let maxCachedSessions = 3
    @State private var cachedSessions: [String: TerminalSessionDescriptor] = [:]
    @State private var cachedSessionOrder: [String] = []

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(nsColor: .windowBackgroundColor))

            if !cachedSessionOrder.isEmpty {
                ForEach(cachedSessionOrder, id: \.self) { sessionID in
                    if let session = cachedSessions[sessionID] {
                        GhosttyTerminalContainer(
                            session: session,
                            isActive: session.id == terminalSession?.id
                        )
                            .id(session.id)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .opacity(session.id == terminalSession?.id ? 1 : 0)
                            .allowsHitTesting(session.id == terminalSession?.id)
                    }
                }
            }

            if isResolvingTerminal && terminalSession == nil {
                ProgressView("Attaching terminal…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if terminalSession == nil {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Terminal")
                        .font(.headline)
                    Text(verbatim: terminalMessage ?? "Select an open worktree to attach the terminal.")
                        .foregroundStyle(.secondary)
                }
                .padding(20)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            cacheCurrentSession()
        }
        .onChange(of: terminalSession?.id) {
            cacheCurrentSession()
        }
        .onDisappear {
            cachedSessions.removeAll()
            cachedSessionOrder.removeAll()
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
    }

    private func cacheCurrentSession() {
        guard let terminalSession else { return }
        cachedSessions[terminalSession.id] = terminalSession
        cachedSessionOrder.removeAll { $0 == terminalSession.id }
        cachedSessionOrder.append(terminalSession.id)

        while cachedSessionOrder.count > maxCachedSessions {
            let evictedSessionID = cachedSessionOrder.removeFirst()
            cachedSessions.removeValue(forKey: evictedSessionID)
        }
    }
}
