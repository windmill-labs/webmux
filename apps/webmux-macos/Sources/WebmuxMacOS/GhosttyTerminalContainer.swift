import SwiftUI

struct GhosttyTerminalContainer: View {
    let session: TerminalSessionDescriptor

    var body: some View {
        switch GhosttyRuntime.shared {
        case .success(let runtime):
            GhosttyTerminalRepresentable(runtime: runtime, session: session)
        case .failure(let error):
            ContentUnavailableView(
                "Ghostty Unavailable",
                systemImage: "terminal",
                description: Text(error.localizedDescription)
            )
        }
    }
}

private struct GhosttyTerminalRepresentable: NSViewRepresentable {
    let runtime: GhosttyRuntime
    let session: TerminalSessionDescriptor

    func makeNSView(context: Context) -> GhosttyTerminalNSView {
        GhosttyTerminalNSView(runtime: runtime, session: session)
    }

    func updateNSView(_ nsView: GhosttyTerminalNSView, context: Context) {
    }
}
