import Foundation

enum CreateWorktreeMode: String, CaseIterable, Identifiable, Codable {
    case new
    case existing

    var id: String { rawValue }
}

struct ProjectSnapshot: Decodable {
    struct Project: Decodable {
        let name: String
        let mainBranch: String
    }

    let project: Project
    let worktrees: [WorktreeSnapshot]
}

struct WorktreeSnapshot: Decodable, Identifiable, Hashable {
    let branch: String
    let path: String
    let dir: String
    let profile: String?
    let agentName: String?
    let mux: Bool
    let dirty: Bool
    let unpushed: Bool
    let paneCount: Int
    let status: String
    let elapsed: String
    let services: [ServiceStatus]
    let prs: [PrEntry]
    let linearIssue: LinkedLinearIssue?
    let creation: WorktreeCreationState?

    var id: String { branch }
}

struct ServiceStatus: Decodable, Hashable {
    let name: String
    let port: Int?
    let running: Bool
    let url: String?
}

struct PrComment: Decodable, Hashable {
    let type: String
    let author: String
    let body: String
    let createdAt: String
    let path: String?
    let line: Int?
    let diffHunk: String?
    let isReply: Bool?
}

struct CiCheck: Decodable, Hashable {
    let name: String
    let status: String
    let url: String?
    let runId: Int?
}

struct PrEntry: Decodable, Hashable {
    let repo: String
    let number: Int
    let state: String
    let url: String
    let updatedAt: String
    let ciStatus: String
    let ciChecks: [CiCheck]
    let comments: [PrComment]
}

struct LinearIssueState: Decodable, Hashable {
    let name: String
    let color: String
    let type: String
}

struct LinkedLinearIssue: Decodable, Hashable {
    let identifier: String
    let url: String
    let state: LinearIssueState
}

struct WorktreeCreationState: Decodable, Hashable {
    let phase: String
}

struct NativeTerminalLaunch: Decodable, Hashable {
    let worktreeId: String
    let branch: String
    let path: String
    let shellCommand: String
}

struct CreateWorktreeRequest: Encodable {
    let mode: CreateWorktreeMode
    let branch: String?
}

struct CreateWorktreeResponse: Decodable {
    let branch: String
}

struct APIErrorPayload: Decodable {
    let error: String
}
