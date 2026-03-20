import AppKit
import Dispatch
import Darwin
import GhosttyKit

private func ghosttyRuntimeWakeupCallback(_ userdata: UnsafeMutableRawPointer?) {
    GhosttyRuntime.wakeup(userdata)
}

private func ghosttyRuntimeActionCallback(
    _ app: ghostty_app_t?,
    _ target: ghostty_target_s,
    _ action: ghostty_action_s
) -> Bool {
    guard let app else { return false }
    return GhosttyRuntime.handleAction(app, target: target, action: action)
}

private func ghosttyRuntimeReadClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ location: ghostty_clipboard_e,
    _ state: UnsafeMutableRawPointer?
) -> Bool {
    GhosttyRuntime.readClipboard(userdata, location: location, state: state)
}

private func ghosttyRuntimeConfirmReadClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ string: UnsafePointer<CChar>?,
    _ state: UnsafeMutableRawPointer?,
    _ request: ghostty_clipboard_request_e
) {
}

private func ghosttyRuntimeWriteClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ location: ghostty_clipboard_e,
    _ content: UnsafePointer<ghostty_clipboard_content_s>?,
    _ len: Int,
    _ confirm: Bool
) {
    GhosttyRuntime.writeClipboard(userdata, location: location, content: content, len: len, confirm: confirm)
}

private func ghosttyRuntimeCloseSurfaceCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ processAlive: Bool
) {
    GhosttyRuntime.closeSurface(userdata, processAlive: processAlive)
}

@MainActor
final class GhosttyRuntime {
    static let shared: Result<GhosttyRuntime, Error> = {
        do {
            return .success(try GhosttyRuntime())
        } catch {
            return .failure(error)
        }
    }()

    private var appStorage: ghostty_app_t?
    private var configStorage: ghostty_config_t?

    var app: ghostty_app_t {
        appStorage!
    }

    init() throws {
        if let resourcesDir = AppEnvironment.shared.ghosttyResourcesDir?.path {
            setenv("GHOSTTY_RESOURCES_DIR", resourcesDir, 1)
        }
        if let terminfoDir = AppEnvironment.shared.ghosttyTerminfoDir?.path {
            setenv("TERMINFO", terminfoDir, 1)
            let existingTerminfoDirs = ProcessInfo.processInfo.environment["TERMINFO_DIRS"]
                .map { $0.split(separator: ":").map(String.init) } ?? []
            let allTerminfoDirs = [terminfoDir] + existingTerminfoDirs.filter { $0 != terminfoDir }
            setenv("TERMINFO_DIRS", allTerminfoDirs.joined(separator: ":"), 1)
        }

        if ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) != GHOSTTY_SUCCESS {
            throw GhosttyRuntimeError.initializationFailed
        }

        guard let config = ghostty_config_new() else {
            throw GhosttyRuntimeError.configInitializationFailed
        }

        ghostty_config_load_default_files(config)
        ghostty_config_load_recursive_files(config)
        ghostty_config_finalize(config)

        var runtimeConfig = ghostty_runtime_config_s(
            userdata: Unmanaged.passUnretained(self).toOpaque(),
            supports_selection_clipboard: false,
            wakeup_cb: ghosttyRuntimeWakeupCallback,
            action_cb: ghosttyRuntimeActionCallback,
            read_clipboard_cb: ghosttyRuntimeReadClipboardCallback,
            confirm_read_clipboard_cb: ghosttyRuntimeConfirmReadClipboardCallback,
            write_clipboard_cb: ghosttyRuntimeWriteClipboardCallback,
            close_surface_cb: ghosttyRuntimeCloseSurfaceCallback
        )

        guard let app = ghostty_app_new(&runtimeConfig, config) else {
            ghostty_config_free(config)
            throw GhosttyRuntimeError.appInitializationFailed
        }

        self.appStorage = app
        self.configStorage = config

        ghostty_app_set_focus(app, NSApp.isActive)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidResignActive),
            name: NSApplication.didResignActiveNotification,
            object: nil
        )
    }

    @objc private func applicationDidBecomeActive() {
        ghostty_app_set_focus(app, true)
    }

    @objc private func applicationDidResignActive() {
        ghostty_app_set_focus(app, false)
    }

    nonisolated fileprivate static func wakeup(_ userdata: UnsafeMutableRawPointer?) {
        guard let userdata else { return }
        let runtime = Unmanaged<GhosttyRuntime>.fromOpaque(userdata).takeUnretainedValue()
        DispatchQueue.main.async {
            ghostty_app_tick(runtime.app)
        }
    }

    nonisolated fileprivate static func handleAction(
        _ app: ghostty_app_t,
        target: ghostty_target_s,
        action: ghostty_action_s
    ) -> Bool {
        let surfaceView = target.tag == GHOSTTY_TARGET_SURFACE ? surfaceView(for: target.target.surface) : nil

        switch action.tag {
        case GHOSTTY_ACTION_QUIT_TIMER,
             GHOSTTY_ACTION_SIZE_LIMIT:
            return false
        case GHOSTTY_ACTION_SHOW_CHILD_EXITED:
            return false
        case GHOSTTY_ACTION_INITIAL_SIZE,
             GHOSTTY_ACTION_CELL_SIZE,
             GHOSTTY_ACTION_SET_TITLE,
             GHOSTTY_ACTION_PWD,
             GHOSTTY_ACTION_RENDERER_HEALTH:
            return true
        case GHOSTTY_ACTION_MOUSE_SHAPE:
            let shape = action.action.mouse_shape
            DispatchQueue.main.async {
                surfaceView?.updateMouseShape(shape)
            }
            return true
        case GHOSTTY_ACTION_MOUSE_VISIBILITY:
            let isVisible = action.action.mouse_visibility == GHOSTTY_MOUSE_VISIBLE
            DispatchQueue.main.async {
                surfaceView?.updateMouseVisibility(isVisible)
            }
            return true
        case GHOSTTY_ACTION_OPEN_URL:
            return openURL(action.action.open_url)
        default:
            return false
        }
    }

    nonisolated fileprivate static func readClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        state: UnsafeMutableRawPointer?
    ) -> Bool {
        guard location == GHOSTTY_CLIPBOARD_STANDARD,
              let surfaceView = surfaceView(from: userdata),
              let surface = surfaceView.surface,
              let string = NSPasteboard.general.string(forType: .string) else {
            return false
        }

        string.withCString { pointer in
            ghostty_surface_complete_clipboard_request(surface, pointer, state, false)
        }
        return true
    }

    nonisolated fileprivate static func writeClipboard(
        _ userdata: UnsafeMutableRawPointer?,
        location: ghostty_clipboard_e,
        content: UnsafePointer<ghostty_clipboard_content_s>?,
        len: Int,
        confirm: Bool
    ) {
        guard location == GHOSTTY_CLIPBOARD_STANDARD,
              let content,
              len > 0 else {
            return
        }

        let preferredText = (0..<len).first(where: { index in
            String(cString: content[index].mime) == "text/plain"
        }).map { String(cString: content[$0].data) }

        guard let text = preferredText ?? String(validatingCString: content[0].data) else {
            return
        }

        if confirm {
            NSSound.beep()
        }

        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    nonisolated fileprivate static func closeSurface(
        _ userdata: UnsafeMutableRawPointer?,
        processAlive: Bool
    ) {
        _ = userdata
        _ = processAlive
    }

    nonisolated private static func surfaceView(from userdata: UnsafeMutableRawPointer?) -> GhosttyTerminalNSView? {
        guard let userdata else { return nil }
        return Unmanaged<GhosttyTerminalNSView>.fromOpaque(userdata).takeUnretainedValue()
    }

    nonisolated private static func surfaceView(for surface: ghostty_surface_t?) -> GhosttyTerminalNSView? {
        guard let surface,
              let userdata = ghostty_surface_userdata(surface) else {
            return nil
        }

        return Unmanaged<GhosttyTerminalNSView>.fromOpaque(userdata).takeUnretainedValue()
    }

    nonisolated private static func openURL(_ value: ghostty_action_open_url_s) -> Bool {
        let rawValue = String(cString: value.url)
        guard let url = URL(string: rawValue) ?? URL(string: "file://\(rawValue)") else {
            return false
        }

        NSWorkspace.shared.open(url)
        return true
    }
}

enum GhosttyRuntimeError: LocalizedError {
    case initializationFailed
    case configInitializationFailed
    case appInitializationFailed

    var errorDescription: String? {
        switch self {
        case .initializationFailed:
            return "Ghostty failed to initialize."
        case .configInitializationFailed:
            return "Ghostty config could not be created."
        case .appInitializationFailed:
            return "Ghostty app state could not be created."
        }
    }
}
