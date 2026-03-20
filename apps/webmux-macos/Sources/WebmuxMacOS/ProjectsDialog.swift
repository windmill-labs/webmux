import SwiftUI

struct ProjectsDialog: View {
    @Environment(\.dismiss) private var dismiss

    @ObservedObject var connectionsStore: ConnectionsStore

    @State private var selectedConnectionID: String?
    @State private var draft: ConnectionDraft
    @State private var errorMessage: String?
    @State private var isSubmitting = false
    @State private var connectionPendingRemoval: ConnectionProfile?

    init(connectionsStore: ConnectionsStore) {
        self.connectionsStore = connectionsStore
        let initialConnection = connectionsStore.selectedConnection ?? connectionsStore.connections.first
        _selectedConnectionID = State(initialValue: initialConnection?.id)
        _draft = State(initialValue: initialConnection.map(ConnectionDraft.init(connection:)) ?? ConnectionDraft())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Projects")
                .font(.title2.weight(.semibold))

            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    List(selection: $selectedConnectionID) {
                        ForEach(connectionsStore.connections) { connection in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(verbatim: connection.name)
                                    .font(.headline)
                                Text(verbatim: connection.selectorLabel)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .tag(Optional(connection.id))
                        }
                    }
                    .frame(minWidth: 220, maxWidth: 240)

                    HStack {
                        Button("New Project") {
                            beginAddConnection()
                        }

                        Button("Remove", role: .destructive) {
                            connectionPendingRemoval = selectedConnection
                        }
                        .disabled(selectedConnection == nil)
                    }
                    .controlSize(.small)
                }

                Divider()

                VStack(alignment: .leading, spacing: 18) {
                    Text(selectedConnection == nil ? "Add Project" : "Edit Project")
                        .font(.headline)

                    Form {
                        TextField("Server URL", text: $draft.apiBaseURL)

                        Picker("Connection Type", selection: $draft.mode) {
                            ForEach(ConnectionMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)

                        if draft.mode == .remote {
                            TextField("SSH Host", text: $draft.sshHost)
                            TextField("SSH User", text: $draft.sshUser)
                            TextField("SSH Port", text: $draft.sshPort)
                        }
                    }
                    .formStyle(.grouped)

                    Text(verbatim: helperText)
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    if let errorMessage {
                        Text(verbatim: errorMessage)
                            .foregroundStyle(.red)
                            .font(.callout)
                    }

                    Spacer()

                    HStack {
                        Spacer()

                        Button("Done") {
                            dismiss()
                        }

                        Button(submitButtonTitle) {
                            Task {
                                await submit()
                            }
                        }
                        .keyboardShortcut(.defaultAction)
                        .disabled(isSubmitting || draft.apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
        .padding(24)
        .frame(width: 820, height: 500)
        .onChange(of: selectedConnectionID) {
            syncDraftWithSelection()
        }
        .confirmationDialog(
            "Remove Project?",
            isPresented: connectionRemovalPresented
        ) {
            Button("Remove", role: .destructive) {
                if let connectionPendingRemoval {
                    removeConnection(connectionPendingRemoval)
                }
            }
        } message: {
            Text(verbatim: "This will remove the saved connection for \(connectionPendingRemoval?.name ?? "this project").")
        }
    }

    private var selectedConnection: ConnectionProfile? {
        guard let selectedConnectionID else { return nil }
        return connectionsStore.connections.first(where: { $0.id == selectedConnectionID })
    }

    private var helperText: String {
        switch draft.mode {
        case .local:
            return "Local connections must use a loopback server URL such as http://127.0.0.1:5111. The terminal will run on this Mac."
        case .remote:
            return "Remote connections attach the terminal over SSH. If SSH Host is empty, the server URL host will be used."
        }
    }

    private var submitButtonTitle: String {
        if isSubmitting {
            return selectedConnection == nil ? "Connecting..." : "Saving..."
        }

        return selectedConnection == nil ? "Test and Add Project" : "Test and Save Project"
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

    private func beginAddConnection() {
        selectedConnectionID = nil
        draft = ConnectionDraft()
        errorMessage = nil
    }

    private func syncDraftWithSelection() {
        errorMessage = nil
        if let selectedConnection {
            draft = ConnectionDraft(connection: selectedConnection)
        } else {
            draft = ConnectionDraft()
        }
    }

    private func removeConnection(_ connection: ConnectionProfile) {
        connectionsStore.removeConnection(connection)
        connectionPendingRemoval = nil
        let nextSelection = connectionsStore.selectedConnection ?? connectionsStore.connections.first
        selectedConnectionID = nextSelection?.id
        if let nextSelection {
            draft = ConnectionDraft(connection: nextSelection)
        } else {
            draft = ConnectionDraft()
        }
    }

    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let savedConnection: ConnectionProfile
            if let selectedConnection {
                savedConnection = try await connectionsStore.updateConnection(selectedConnection, from: draft)
            } else {
                savedConnection = try await connectionsStore.addConnection(from: draft)
            }

            selectedConnectionID = savedConnection.id
            draft = ConnectionDraft(connection: savedConnection)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
