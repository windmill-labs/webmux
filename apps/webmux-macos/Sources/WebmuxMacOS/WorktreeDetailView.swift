import SwiftUI

struct WorktreeDetailView: View {
    let worktree: WorktreeSnapshot?
    let isResolvingTerminal: Bool
    let terminalSession: TerminalSessionDescriptor?
    let terminalMessage: String?
    let onOpenWorktree: () -> Void
    let onCloseWorktree: () -> Void

    var body: some View {
        Group {
            if let worktree {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: worktree.branch)
                            .font(.largeTitle.weight(.semibold))

                        Text(verbatim: worktree.path)
                            .font(.callout)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 12) {
                            Label {
                                Text(verbatim: worktree.mux ? "Open" : "Closed")
                            } icon: {
                                Image(systemName: worktree.mux ? "bolt.horizontal.circle.fill" : "pause.circle")
                            }
                            Label {
                                Text(verbatim: worktree.status)
                            } icon: {
                                Image(systemName: "terminal")
                            }
                            Label {
                                Text(verbatim: "\(worktree.paneCount) panes")
                            } icon: {
                                Image(systemName: "square.split.2x1")
                            }
                        }
                        .font(.callout)
                    }

                    HStack(spacing: 12) {
                        Button("Open Worktree", action: onOpenWorktree)
                            .disabled(worktree.mux)

                        Button("Close Worktree", action: onCloseWorktree)
                            .disabled(!worktree.mux)
                    }

                    TerminalPanelView(
                        isResolvingTerminal: isResolvingTerminal,
                        terminalSession: terminalSession,
                        terminalMessage: terminalMessage
                    )
                }
                .padding(24)
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

private struct TerminalPanelView: View {
    let isResolvingTerminal: Bool
    let terminalSession: TerminalSessionDescriptor?
    let terminalMessage: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(nsColor: .windowBackgroundColor))

            if isResolvingTerminal {
                ProgressView("Attaching terminal…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let terminalSession {
                GhosttyTerminalContainer(session: terminalSession)
                    .id(terminalSession.id)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Terminal")
                        .font(.headline)
                    Text(verbatim: terminalMessage ?? "Select an open worktree to attach the terminal.")
                        .foregroundStyle(.secondary)
                }
                .padding(20)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
    }
}
