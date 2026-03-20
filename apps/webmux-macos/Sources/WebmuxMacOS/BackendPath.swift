import Foundation

enum BackendPath {
    static let project = "api/project"
    static let worktrees = "api/worktrees"

    static func openWorktree(named branch: String) -> String {
        "api/worktrees/\(encodePathSegment(branch))/open"
    }

    static func closeWorktree(named branch: String) -> String {
        "api/worktrees/\(encodePathSegment(branch))/close"
    }

    static func terminalLaunch(named branch: String) -> String {
        "api/worktrees/\(encodePathSegment(branch))/terminal-launch"
    }

    static func encodePathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
