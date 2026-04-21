import Foundation

enum AppEnvironment {
    static let shared = EnvironmentValues()

    struct EnvironmentValues {
        let repoRoot: URL
        let ghosttyResourcesDir: URL?
        let ghosttyTerminfoDir: URL?

        init(processInfo: ProcessInfo = .processInfo) {
            let environment = processInfo.environment
            let sourceFile = URL(fileURLWithPath: #filePath)
            let fallbackRoot = sourceFile
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
            let detectedRoot = Self.findRepoRoot(startingAt: sourceFile.deletingLastPathComponent()) ?? fallbackRoot
            repoRoot = URL(fileURLWithPath: environment["WEBMUX_NATIVE_REPO_ROOT"] ?? detectedRoot.path)
            ghosttyResourcesDir = Self.findGhosttyResourcesDir(environment: environment, repoRoot: repoRoot)
            ghosttyTerminfoDir = Self.findGhosttyTerminfoDir(ghosttyResourcesDir: ghosttyResourcesDir)
        }

        private static func findRepoRoot(startingAt url: URL) -> URL? {
            var current = url
            let fileManager = FileManager.default

            while current.path != "/" {
                if fileManager.fileExists(atPath: current.appending(path: ".git").path) {
                    return current
                }

                current.deleteLastPathComponent()
            }

            return nil
        }

        private static func findGhosttyResourcesDir(
            environment: [String: String],
            repoRoot: URL
        ) -> URL? {
            let fileManager = FileManager.default

            if let override = environment["WEBMUX_NATIVE_GHOSTTY_RESOURCES_DIR"] ?? environment["GHOSTTY_RESOURCES_DIR"] {
                let url = URL(fileURLWithPath: override)
                if fileManager.fileExists(atPath: url.path) {
                    return url
                }
            }

            let bundledResources = repoRoot
                .appending(path: "apps")
                .appending(path: "webmux-macos")
                .appending(path: "ThirdParty")
                .appending(path: "GhosttyResources")
                .appending(path: "share")
                .appending(path: "ghostty")
            if fileManager.fileExists(atPath: bundledResources.path) {
                return bundledResources
            }

            return nil
        }

        private static func findGhosttyTerminfoDir(ghosttyResourcesDir: URL?) -> URL? {
            guard let ghosttyResourcesDir else { return nil }

            let terminfoDir = ghosttyResourcesDir
                .deletingLastPathComponent()
                .appending(path: "terminfo")
            guard FileManager.default.fileExists(atPath: terminfoDir.path) else {
                return nil
            }

            return terminfoDir
        }
    }
}
