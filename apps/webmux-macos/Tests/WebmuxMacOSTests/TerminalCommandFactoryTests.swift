import XCTest
@testable import WebmuxMacOS

final class TerminalCommandFactoryTests: XCTestCase {
    func testMakeSessionUsesBackendCommandDirectlyForLocalProfiles() {
        let launch = NativeTerminalLaunch(
            worktreeId: "wt_1",
            branch: "main",
            path: "/tmp/repo",
            shellCommand: "tmux attach -t wm"
        )
        let profile = ConnectionProfile(
            id: "local",
            name: "Local",
            mode: .local,
            apiBaseURL: URL(string: "http://127.0.0.1:5111")!,
            ssh: nil
        )

        let session = TerminalCommandFactory.makeSession(
            for: launch,
            profile: profile,
            workingDirectory: launch.path
        )

        XCTAssertEqual(session.id, "local:wt_1")
        XCTAssertEqual(session.command, "tmux attach -t wm")
        XCTAssertEqual(session.workingDirectory, "/tmp/repo")
    }

    func testMakeSessionWrapsRemoteCommandInSSH() {
        let launch = NativeTerminalLaunch(
            worktreeId: "wt_2",
            branch: "feature/test",
            path: "/remote/repo",
            shellCommand: "tmux attach -t 'wm native'"
        )
        let profile = ConnectionProfile(
            id: "remote",
            name: "Remote",
            mode: .remote,
            apiBaseURL: URL(string: "http://100.116.162.22:5111")!,
            ssh: SSHConnectionConfig(host: "100.116.162.22", user: "farhad", port: 2222)
        )

        let session = TerminalCommandFactory.makeSession(
            for: launch,
            profile: profile,
            workingDirectory: "/Users/farhad"
        )

        XCTAssertEqual(session.id, "remote:wt_2")
        XCTAssertEqual(session.workingDirectory, "/Users/farhad")
        XCTAssertTrue(session.command.contains("env TERM=xterm-256color ssh -tt"))
        XCTAssertTrue(session.command.contains("-p 2222"))
        XCTAssertTrue(session.command.contains("farhad@100.116.162.22"))
        XCTAssertTrue(session.command.contains("tmux attach -t"))
    }
}
