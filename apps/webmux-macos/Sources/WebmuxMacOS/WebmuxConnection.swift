import Foundation

@MainActor
protocol WebmuxConnection {
    var profile: ConnectionProfile { get }
    var client: BackendClient { get }

    func makeTerminalSession(for launch: NativeTerminalLaunch) -> TerminalSessionDescriptor
}

final class ConfiguredWebmuxConnection: WebmuxConnection {
    let profile: ConnectionProfile
    let client: BackendClient

    private let remoteWorkingDirectory: String

    init(
        profile: ConnectionProfile,
        client: BackendClient,
        remoteWorkingDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) {
        self.profile = profile
        self.client = client
        self.remoteWorkingDirectory = remoteWorkingDirectory
    }

    func makeTerminalSession(for launch: NativeTerminalLaunch) -> TerminalSessionDescriptor {
        TerminalCommandFactory.makeSession(
            for: launch,
            profile: profile,
            workingDirectory: profile.mode == .local ? launch.path : remoteWorkingDirectory
        )
    }
}

enum WebmuxConnectionFactory {
    @MainActor
    static func make(profile: ConnectionProfile) -> any WebmuxConnection {
        ConfiguredWebmuxConnection(
            profile: profile,
            client: BackendClient(baseURL: profile.apiBaseURL)
        )
    }
}
