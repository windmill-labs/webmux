import XCTest
@testable import WebmuxMacOS

final class BackendPathTests: XCTestCase {
    func testEncodePathSegmentEscapesSlashAndSpaces() {
        XCTAssertEqual(
            BackendPath.encodePathSegment("feature/foo bar"),
            "feature%2Ffoo%20bar"
        )
    }

    func testWorktreePathsReuseEncodedBranchSegment() {
        let branch = "farhad/win 1892"

        XCTAssertEqual(
            BackendPath.openWorktree(named: branch),
            "api/worktrees/farhad%2Fwin%201892/open"
        )
        XCTAssertEqual(
            BackendPath.closeWorktree(named: branch),
            "api/worktrees/farhad%2Fwin%201892/close"
        )
        XCTAssertEqual(
            BackendPath.removeWorktree(named: branch),
            "api/worktrees/farhad%2Fwin%201892"
        )
        XCTAssertEqual(
            BackendPath.mergeWorktree(named: branch),
            "api/worktrees/farhad%2Fwin%201892/merge"
        )
        XCTAssertEqual(
            BackendPath.terminalLaunch(named: branch),
            "api/worktrees/farhad%2Fwin%201892/terminal-launch"
        )
    }
}
