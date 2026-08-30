import Foundation

struct TerminalSessionDescriptor: Hashable, Identifiable {
    let id: String
    let command: String
    let workingDirectory: String
}
