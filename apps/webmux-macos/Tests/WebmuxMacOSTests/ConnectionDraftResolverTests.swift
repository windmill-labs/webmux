import XCTest
@testable import WebmuxMacOS

final class ConnectionDraftResolverTests: XCTestCase {
    func testResolveLocalConnectionNormalizesLoopbackURL() throws {
        var draft = ConnectionDraft()
        draft.apiBaseURL = "HTTP://LOCALHOST:5111/?foo=bar#frag"
        draft.mode = .local

        let resolved = try ConnectionDraftResolver.resolve(draft)

        XCTAssertEqual(resolved.mode, .local)
        XCTAssertEqual(resolved.apiBaseURL.absoluteString, "http://localhost:5111")
        XCTAssertNil(resolved.ssh)
    }

    func testResolveLocalConnectionRejectsNonLoopbackHost() {
        var draft = ConnectionDraft()
        draft.apiBaseURL = "http://100.116.162.22:5111"
        draft.mode = .local

        XCTAssertThrowsError(try ConnectionDraftResolver.resolve(draft)) { error in
            guard case ConnectionStoreError.localConnectionRequiresLoopbackHost = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
    }

    func testResolveRemoteConnectionDefaultsSSHHostUserAndPort() throws {
        var draft = ConnectionDraft()
        draft.apiBaseURL = "https://Machine.Example.ts.net:5111/"
        draft.mode = .remote
        draft.sshHost = ""
        draft.sshUser = ""
        draft.sshPort = ""

        let resolved = try ConnectionDraftResolver.resolve(draft)

        XCTAssertEqual(resolved.mode, .remote)
        XCTAssertEqual(resolved.apiBaseURL.absoluteString, "https://machine.example.ts.net:5111")
        XCTAssertEqual(resolved.ssh, SSHConnectionConfig(host: "machine.example.ts.net", user: NSUserName(), port: 22))
    }

    func testResolveRemoteConnectionRejectsInvalidSSHPort() {
        var draft = ConnectionDraft()
        draft.apiBaseURL = "http://100.116.162.22:5111"
        draft.mode = .remote
        draft.sshPort = "70000"

        XCTAssertThrowsError(try ConnectionDraftResolver.resolve(draft)) { error in
            guard case ConnectionStoreError.invalidSSHPort("70000") = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }
    }
}
