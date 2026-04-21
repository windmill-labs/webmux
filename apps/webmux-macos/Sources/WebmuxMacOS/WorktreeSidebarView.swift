import SwiftUI

struct WorktreeSidebarView: View {
    let title: String
    let worktrees: [WorktreeSnapshot]
    @Binding var selection: String?
    let canCreateWorktree: Bool
    let canRefresh: Bool
    let onCreateWorktree: () -> Void
    let onRefresh: () -> Void
    let onOpenWorktree: (String) -> Void
    let onCloseWorktree: (String) -> Void
    let onMergeWorktree: (String) -> Void
    let onRemoveWorktree: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: onCreateWorktree) {
                    Label("Add Worktree", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!canCreateWorktree)

                Spacer(minLength: 0)

                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .help("Refresh worktrees")
                .disabled(!canRefresh)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            List(selection: $selection) {
                ForEach(worktrees) { worktree in
                    WorktreeSidebarRow(
                        worktree: worktree,
                        onOpenWorktree: onOpenWorktree,
                        onCloseWorktree: onCloseWorktree,
                        onMergeWorktree: onMergeWorktree,
                        onRemoveWorktree: onRemoveWorktree
                    )
                    .tag(worktree.branch)
                }
            }
        }
        .navigationTitle(title)
    }
}

private struct WorktreeSidebarRow: View {
    let worktree: WorktreeSnapshot
    let onOpenWorktree: (String) -> Void
    let onCloseWorktree: (String) -> Void
    let onMergeWorktree: (String) -> Void
    let onRemoveWorktree: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: worktree.branch)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                if !worktree.prs.isEmpty {
                    WrappingFlowLayout(spacing: 6, rowSpacing: 6) {
                    ForEach(worktree.prs, id: \.self) { pr in
                        PRBadgeView(pr: pr, clickable: false)
                    }
                }
                }
            }

            Spacer(minLength: 0)

            Menu {
                if worktree.mux {
                    Button("Close Worktree") {
                        onCloseWorktree(worktree.branch)
                    }
                } else {
                    Button("Open Worktree") {
                        onOpenWorktree(worktree.branch)
                    }
                }

                Button("Merge Worktree") {
                    onMergeWorktree(worktree.branch)
                }

                Button("Remove Worktree", role: .destructive) {
                    onRemoveWorktree(worktree.branch)
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(.vertical, 4)
    }
}
