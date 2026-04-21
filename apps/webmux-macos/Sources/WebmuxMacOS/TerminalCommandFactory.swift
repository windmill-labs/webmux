import Foundation

enum TerminalCommandFactory {
    static func makeSession(
        for launch: NativeTerminalLaunch,
        profile: ConnectionProfile,
        workingDirectory: String
    ) -> TerminalSessionDescriptor {
        return TerminalSessionDescriptor(
            id: UUID().uuidString,
            command: buildAttachCommand(
                for: launch,
                profile: profile
            ),
            workingDirectory: workingDirectory
        )
    }

    private static func buildAttachCommand(
        for launch: NativeTerminalLaunch,
        profile: ConnectionProfile
    ) -> String {
        switch profile.mode {
        case .local:
            return launch.shellCommand
        case .remote:
            guard let ssh = profile.ssh else {
                return launch.shellCommand
            }

            var sshComponents = ["env", "TERM=xterm-256color", "ssh", "-tt"]
            if ssh.port != 22 {
                sshComponents.append(contentsOf: ["-p", ShellQuoter.quote(String(ssh.port))])
            }
            sshComponents.append(ShellQuoter.quote(ssh.destination))
            sshComponents.append(ShellQuoter.quote(launch.shellCommand))
            return "/bin/sh -lc \(ShellQuoter.quote(sshComponents.joined(separator: " ")))"
        }
    }
}

enum ShellQuoter {
    static func quote(_ value: String) -> String {
        guard !value.isEmpty else { return "''" }
        let unsafe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
        if value.rangeOfCharacter(from: unsafe.inverted) == nil {
            return value
        }

        return "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }
}
