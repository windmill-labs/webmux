import Foundation

enum ConnectionMode: String, Codable, Hashable, CaseIterable, Identifiable {
    case local
    case remote

    var id: Self { self }

    var title: String {
        switch self {
        case .local:
            return "Local"
        case .remote:
            return "Remote"
        }
    }
}

struct SSHConnectionConfig: Codable, Hashable {
    let host: String
    let user: String
    let port: Int

    var destination: String {
        "\(user)@\(host)"
    }
}

struct ConnectionProfile: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let mode: ConnectionMode
    let apiBaseURL: URL
    let ssh: SSHConnectionConfig?

    var selectorLabel: String {
        switch mode {
        case .local:
            return "\(name) (Local)"
        case .remote:
            return "\(name) (Remote)"
        }
    }
}

struct ConnectionDraft: Equatable {
    var apiBaseURL = ""
    var mode: ConnectionMode = .local
    var sshHost = ""
    var sshUser = NSUserName()
    var sshPort = "22"

    init() {}

    init(connection: ConnectionProfile) {
        apiBaseURL = connection.apiBaseURL.absoluteString
        mode = connection.mode
        sshHost = connection.ssh?.host ?? connection.apiBaseURL.host() ?? ""
        sshUser = connection.ssh?.user ?? NSUserName()
        sshPort = String(connection.ssh?.port ?? 22)
    }
}
