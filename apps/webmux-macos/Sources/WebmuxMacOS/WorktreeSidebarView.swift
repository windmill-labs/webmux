import SwiftUI

struct WorktreeSidebarView: View {
    let title: String
    let worktrees: [WorktreeSnapshot]
    @Binding var selection: String?

    var body: some View {
        List(selection: $selection) {
            ForEach(worktrees) { worktree in
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: worktree.branch)
                        .font(.headline)

                    HStack(spacing: 8) {
                        Text(verbatim: worktree.mux ? "open" : "closed")
                        Text(verbatim: worktree.status)
                        if let profile = worktree.profile {
                            Text(verbatim: profile)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                .tag(worktree.branch)
            }
        }
        .navigationTitle(title)
    }
}
