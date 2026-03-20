import SwiftUI

struct ProjectToolbar: ToolbarContent {
    let connections: [ConnectionProfile]
    @Binding var selectedConnectionID: String?
    let canEditSelectedConnection: Bool
    let canCreateWorktree: Bool
    let canRefresh: Bool
    let onAddConnection: () -> Void
    let onEditConnection: () -> Void
    let onRemoveConnection: () -> Void
    let onCreateWorktree: () -> Void
    let onRefresh: () -> Void

    var body: some ToolbarContent {
        ToolbarItemGroup {
            if !connections.isEmpty {
                Picker("Project", selection: $selectedConnectionID) {
                    ForEach(connections) { connection in
                        Text(verbatim: connection.selectorLabel)
                            .tag(Optional(connection.id))
                    }
                }
                .labelsHidden()
                .frame(width: 240)
            }

            Button(action: onAddConnection) {
                Label("Add Project", systemImage: "server.rack")
            }

            if !connections.isEmpty {
                Button(action: onEditConnection) {
                    Label("Edit Project", systemImage: "pencil")
                }
                .disabled(!canEditSelectedConnection)

                Button(role: .destructive, action: onRemoveConnection) {
                    Label("Remove Project", systemImage: "trash")
                }
                .disabled(!canEditSelectedConnection)

                Button(action: onCreateWorktree) {
                    Label("Create Worktree", systemImage: "plus")
                }
                .disabled(!canCreateWorktree)

                Button(action: onRefresh) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(!canRefresh)
            }
        }
    }
}
