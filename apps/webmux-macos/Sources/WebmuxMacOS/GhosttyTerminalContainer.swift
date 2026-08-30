import SwiftUI

struct GhosttyTerminalContainer: View {
    let session: TerminalSessionDescriptor
    let isActive: Bool

    var body: some View {
        switch GhosttyRuntime.shared {
        case .success(let runtime):
            GhosttyTerminalRepresentable(
                runtime: runtime,
                session: session,
                isActive: isActive
            )
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
    let isActive: Bool

    func makeNSView(context: Context) -> GhosttyTerminalNSView {
        let view = GhosttyTerminalNSView(runtime: runtime, session: session)
        view.setActiveState(isActive)
        return view
    }

    func updateNSView(_ nsView: GhosttyTerminalNSView, context: Context) {
        nsView.setActiveState(isActive)
    }
}
