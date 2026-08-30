// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "webmux-macos",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(
            name: "WebmuxMacOS",
            targets: ["WebmuxMacOS"]
        ),
    ],
    targets: [
        .binaryTarget(
            name: "GhosttyKit",
            path: "ThirdParty/GhosttyKit.xcframework"
        ),
        .executableTarget(
            name: "WebmuxMacOS",
            dependencies: ["GhosttyKit"],
            linkerSettings: [
                .linkedFramework("Carbon"),
                .linkedLibrary("c++"),
            ]
        ),
        .testTarget(
            name: "WebmuxMacOSTests",
            dependencies: ["WebmuxMacOS"]
        ),
    ]
)
