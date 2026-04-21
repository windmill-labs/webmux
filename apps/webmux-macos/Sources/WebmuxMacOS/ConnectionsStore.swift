import Foundation

@MainActor
final class ConnectionsStore: ObservableObject {
    @Published private(set) var connections: [ConnectionProfile]
    @Published var selectedConnectionID: String? {
        didSet {
            persistSelectedConnectionID()
        }
    }

    private static let connectionsKey = "webmux.macos.savedConnections"
    private static let selectedConnectionIDKey = "webmux.macos.selectedConnectionID"
    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    private let userDefaults: UserDefaults
    private let projectFetcher: (URL) async throws -> ProjectSnapshot

    init(
        userDefaults: UserDefaults = .standard,
        projectFetcher: @escaping (URL) async throws -> ProjectSnapshot = {
            try await BackendClient(baseURL: $0).fetchProject()
        }
    ) {
        self.userDefaults = userDefaults
        self.projectFetcher = projectFetcher
        connections = Self.loadConnections(from: userDefaults)

        let storedSelection = userDefaults.string(forKey: Self.selectedConnectionIDKey)
        if let storedSelection,
           connections.contains(where: { $0.id == storedSelection }) {
            selectedConnectionID = storedSelection
        } else {
            selectedConnectionID = connections.first?.id
        }
    }

    var selectedConnection: ConnectionProfile? {
        guard let selectedConnectionID else { return nil }
        return connections.first(where: { $0.id == selectedConnectionID })
    }

    func addConnection(from draft: ConnectionDraft) async throws -> ConnectionProfile {
        let profile = try await buildProfile(from: draft)
        connections.append(profile)
        persistConnections()
        selectedConnectionID = profile.id
        return profile
    }

    func updateConnection(_ connection: ConnectionProfile, from draft: ConnectionDraft) async throws -> ConnectionProfile {
        let updated = try await buildProfile(from: draft, existingID: connection.id)

        guard let index = connections.firstIndex(where: { $0.id == connection.id }) else {
            throw ConnectionStoreError.connectionNotFound
        }

        connections[index] = updated
        persistConnections()
        if selectedConnectionID == connection.id {
            selectedConnectionID = updated.id
        }
        return updated
    }

    func removeConnection(_ connection: ConnectionProfile) {
        guard let index = connections.firstIndex(where: { $0.id == connection.id }) else {
            return
        }

        connections.remove(at: index)

        if selectedConnectionID == connection.id {
            let replacement = connections.indices.contains(index) ? connections[index] : connections.last
            selectedConnectionID = replacement?.id
        }

        persistConnections()
    }

    private func buildProfile(
        from draft: ConnectionDraft,
        existingID: String? = nil
    ) async throws -> ConnectionProfile {
        let resolved = try ConnectionDraftResolver.resolve(draft)
        try ensureNoDuplicate(for: resolved, excluding: existingID)

        let snapshot = try await projectFetcher(resolved.apiBaseURL)
        return ConnectionProfile(
            id: existingID ?? UUID().uuidString,
            name: snapshot.project.name,
            mode: resolved.mode,
            apiBaseURL: resolved.apiBaseURL,
            ssh: resolved.ssh
        )
    }

    private func ensureNoDuplicate(
        for draft: ResolvedConnectionDraft,
        excluding excludedID: String? = nil
    ) throws {
        let alreadyExists = connections.contains { connection in
            guard connection.id != excludedID else { return false }
            return connection.mode == draft.mode &&
                connection.apiBaseURL.absoluteString == draft.apiBaseURL.absoluteString &&
                connection.ssh == draft.ssh
        }

        if alreadyExists {
            throw ConnectionStoreError.duplicateConnection
        }
    }

    private func persistConnections() {
        guard let data = try? Self.encoder.encode(connections) else { return }
        userDefaults.set(data, forKey: Self.connectionsKey)
    }

    private func persistSelectedConnectionID() {
        userDefaults.set(selectedConnectionID, forKey: Self.selectedConnectionIDKey)
    }

    private static func loadConnections(from userDefaults: UserDefaults) -> [ConnectionProfile] {
        guard let data = userDefaults.data(forKey: connectionsKey),
              let decoded = try? decoder.decode([ConnectionProfile].self, from: data) else {
            return []
        }

        return decoded
    }
}

enum ConnectionStoreError: LocalizedError {
    case missingServerURL
    case invalidServerURL(String)
    case localConnectionRequiresLoopbackHost
    case invalidSSHPort(String)
    case duplicateConnection
    case connectionNotFound

    var errorDescription: String? {
        switch self {
        case .missingServerURL:
            return "Enter a webmux server URL."
        case .invalidServerURL(let value):
            return "The server URL is invalid: \(value)"
        case .localConnectionRequiresLoopbackHost:
            return "Local connections must use a loopback server URL such as http://127.0.0.1:5111."
        case .invalidSSHPort(let value):
            return "The SSH port is invalid: \(value)"
        case .duplicateConnection:
            return "That project connection has already been added."
        case .connectionNotFound:
            return "That project connection could not be found."
        }
    }
}
