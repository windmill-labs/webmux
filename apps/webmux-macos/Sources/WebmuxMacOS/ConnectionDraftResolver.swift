import Foundation

struct ResolvedConnectionDraft: Equatable {
    let mode: ConnectionMode
    let apiBaseURL: URL
    let ssh: SSHConnectionConfig?
}

enum ConnectionDraftResolver {
    static func resolve(_ draft: ConnectionDraft) throws -> ResolvedConnectionDraft {
        let rawURL = draft.apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawURL.isEmpty else {
            throw ConnectionStoreError.missingServerURL
        }

        guard var components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host?.lowercased() else {
            throw ConnectionStoreError.invalidServerURL(rawURL)
        }

        components.scheme = scheme
        components.host = host
        components.query = nil
        components.fragment = nil
        if components.path == "/" {
            components.path = ""
        }

        guard let apiBaseURL = components.url else {
            throw ConnectionStoreError.invalidServerURL(rawURL)
        }

        switch draft.mode {
        case .local:
            guard isLoopbackHost(host) else {
                throw ConnectionStoreError.localConnectionRequiresLoopbackHost
            }

            return ResolvedConnectionDraft(
                mode: .local,
                apiBaseURL: apiBaseURL,
                ssh: nil
            )
        case .remote:
            let sshHost = nonEmpty(draft.sshHost)?.lowercased() ?? host
            let sshUser = nonEmpty(draft.sshUser) ?? NSUserName()
            let sshPort = try resolveSSHPort(from: draft.sshPort)
            return ResolvedConnectionDraft(
                mode: .remote,
                apiBaseURL: apiBaseURL,
                ssh: SSHConnectionConfig(host: sshHost, user: sshUser, port: sshPort)
            )
        }
    }

    static func isLoopbackHost(_ host: String) -> Bool {
        switch host {
        case "localhost", "127.0.0.1", "::1":
            return true
        default:
            return false
        }
    }

    static func resolveSSHPort(from rawValue: String) throws -> Int {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 22 }
        guard let port = Int(trimmed),
              (1...65535).contains(port) else {
            throw ConnectionStoreError.invalidSSHPort(rawValue)
        }

        return port
    }

    static func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
