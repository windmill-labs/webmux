import XCTest
@testable import WebmuxMacOS

@MainActor
final class ConnectionsStoreTests: XCTestCase {
    func testAddConnectionSelectsAndPersistsProfile() async throws {
        let userDefaults = makeUserDefaults()
        let store = ConnectionsStore(
            userDefaults: userDefaults,
            projectFetcher: { _ in
                ProjectSnapshot(
                    project: .init(name: "Remote Project", mainBranch: "main"),
                    worktrees: []
                )
            }
        )

        var draft = ConnectionDraft()
        draft.apiBaseURL = "http://127.0.0.1:5111"
        draft.mode = .local

        let profile = try await store.addConnection(from: draft)

        XCTAssertEqual(store.connections, [profile])
        XCTAssertEqual(store.selectedConnectionID, profile.id)

        let reloadedStore = ConnectionsStore(
            userDefaults: userDefaults,
            projectFetcher: { _ in
                XCTFail("Reload should not fetch project")
                return ProjectSnapshot(project: .init(name: "", mainBranch: ""), worktrees: [])
            }
        )
        XCTAssertEqual(reloadedStore.connections, [profile])
        XCTAssertEqual(reloadedStore.selectedConnectionID, profile.id)
    }

    func testAddConnectionRejectsDuplicateProfile() async throws {
        let store = ConnectionsStore(
            userDefaults: makeUserDefaults(),
            projectFetcher: { _ in
                ProjectSnapshot(project: .init(name: "Project", mainBranch: "main"), worktrees: [])
            }
        )

        var draft = ConnectionDraft()
        draft.apiBaseURL = "http://127.0.0.1:5111"
        draft.mode = .local

        _ = try await store.addConnection(from: draft)

        do {
            _ = try await store.addConnection(from: draft)
            XCTFail("Expected duplicate connection error")
        } catch {
            guard case ConnectionStoreError.duplicateConnection = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
    }

    func testUpdateConnectionPreservesIdentityAndSelection() async throws {
        let store = ConnectionsStore(
            userDefaults: makeUserDefaults(),
            projectFetcher: { url in
                let projectName = url.host() == "127.0.0.1" ? "Local Project" : "Remote Project"
                return ProjectSnapshot(project: .init(name: projectName, mainBranch: "main"), worktrees: [])
            }
        )

        var draft = ConnectionDraft()
        draft.apiBaseURL = "http://127.0.0.1:5111"
        draft.mode = .local
        let original = try await store.addConnection(from: draft)

        var updatedDraft = ConnectionDraft()
        updatedDraft.apiBaseURL = "http://100.116.162.22:5111"
        updatedDraft.mode = .remote
        updatedDraft.sshHost = "100.116.162.22"
        updatedDraft.sshUser = "farhad"

        let updated = try await store.updateConnection(original, from: updatedDraft)

        XCTAssertEqual(updated.id, original.id)
        XCTAssertEqual(updated.name, "Remote Project")
        XCTAssertEqual(store.selectedConnectionID, original.id)
        XCTAssertEqual(store.connections, [updated])
    }

    private func makeUserDefaults() -> UserDefaults {
        let suiteName = "ConnectionsStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        addTeardownBlock {
            defaults.removePersistentDomain(forName: suiteName)
        }
        return defaults
    }
}
