import SwiftUI

struct ProjectToolbar: ToolbarContent {
    let connections: [ConnectionProfile]
    @Binding var selectedConnectionID: String?
    let onManageProjects: () -> Void

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

            Button(action: onManageProjects) {
                Label("Projects", systemImage: "server.rack")
            }
        }
    }
}
