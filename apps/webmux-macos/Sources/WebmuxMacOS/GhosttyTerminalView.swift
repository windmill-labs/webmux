import AppKit
import GhosttyKit

final class GhosttyTerminalNSView: NSView {
    let session: TerminalSessionDescriptor

    private weak var runtime: GhosttyRuntime?
    nonisolated(unsafe) private var surfaceStorage: ghostty_surface_t?
    private let windowObserverController = GhosttyWindowObserverController()
    private var trackingAreaRef: NSTrackingArea?
    private var lastSurfaceSize: CGSize?
    private var lastSurfaceScale: CGFloat?
    private var didCleanUp = false

    nonisolated var surface: ghostty_surface_t? {
        surfaceStorage
    }

    override var acceptsFirstResponder: Bool { true }

    init(runtime: GhosttyRuntime, session: TerminalSessionDescriptor) {
        self.runtime = runtime
        self.session = session
        super.init(frame: NSRect(x: 0, y: 0, width: 900, height: 700))
        createSurface()
        syncGeometry()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        MainActor.assumeIsolated {
            cleanUp()
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureWindowObservers()
        syncWindowMetadata()
        syncFocus()
        syncGeometry()
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        if newWindow == nil {
            cleanUp()
        }
    }

    override func viewWillMove(toSuperview newSuperview: NSView?) {
        super.viewWillMove(toSuperview: newSuperview)
        if newSuperview == nil {
            cleanUp()
        }
    }

    override func layout() {
        super.layout()
        syncGeometry()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        syncGeometry()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()

        if let trackingAreaRef {
            removeTrackingArea(trackingAreaRef)
        }

        let trackingAreaRef = NSTrackingArea(
            rect: bounds,
            options: [
                .activeAlways,
                .inVisibleRect,
                .mouseMoved,
                .mouseEnteredAndExited,
            ],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(trackingAreaRef)
        self.trackingAreaRef = trackingAreaRef
    }

    override func becomeFirstResponder() -> Bool {
        let result = super.becomeFirstResponder()
        if result {
            syncFocus()
        }
        return result
    }

    override func resignFirstResponder() -> Bool {
        let result = super.resignFirstResponder()
        if result {
            syncFocus()
        }
        return result
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.type == .keyDown,
              let surfaceStorage else {
            return false
        }

        var flags = ghostty_binding_flags_e(0)
        var keyEvent = event.ghosttyKeyEvent(GHOSTTY_ACTION_PRESS)
        let handled: Bool
        if let characters = event.characters {
            handled = characters.withCString { pointer in
                keyEvent.text = pointer
                return ghostty_surface_key_is_binding(surfaceStorage, keyEvent, &flags)
            }
        } else {
            handled = ghostty_surface_key_is_binding(surfaceStorage, keyEvent, &flags)
        }

        if handled {
            _ = sendKeyAction(GHOSTTY_ACTION_PRESS, event: event)
        }

        return handled
    }

    override func keyDown(with event: NSEvent) {
        guard let surfaceStorage else { return }

        let translationMods = GhosttyInputSupport.eventModifierFlags(
            from: ghostty_surface_key_translation_mods(
                surfaceStorage,
                GhosttyInputSupport.ghosttyMods(from: event.modifierFlags)
            )
        )
        let translatedEvent = event.withModifierFlags(translationMods)
        let action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS
        _ = sendKeyAction(action, event: event, translationEvent: translatedEvent)
    }

    override func keyUp(with event: NSEvent) {
        _ = sendKeyAction(GHOSTTY_ACTION_RELEASE, event: event)
    }

    override func flagsChanged(with event: NSEvent) {
        let mod: UInt32
        switch event.keyCode {
        case 0x39: mod = GHOSTTY_MODS_CAPS.rawValue
        case 0x38, 0x3C: mod = GHOSTTY_MODS_SHIFT.rawValue
        case 0x3B, 0x3E: mod = GHOSTTY_MODS_CTRL.rawValue
        case 0x3A, 0x3D: mod = GHOSTTY_MODS_ALT.rawValue
        case 0x37, 0x36: mod = GHOSTTY_MODS_SUPER.rawValue
        default:
            return
        }

        let mods = GhosttyInputSupport.ghosttyMods(from: event.modifierFlags)
        let action: ghostty_input_action_e = mods.rawValue & mod == 0 ? GHOSTTY_ACTION_RELEASE : GHOSTTY_ACTION_PRESS
        _ = sendKeyAction(action, event: event)
    }

    override func mouseDown(with event: NSEvent) {
        sendMouseButton(state: GHOSTTY_MOUSE_PRESS, button: GHOSTTY_MOUSE_LEFT, event: event)
    }

    override func mouseUp(with event: NSEvent) {
        sendMouseButton(state: GHOSTTY_MOUSE_RELEASE, button: GHOSTTY_MOUSE_LEFT, event: event)
        if let surfaceStorage {
            ghostty_surface_mouse_pressure(surfaceStorage, 0, 0)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        sendMouseButton(state: GHOSTTY_MOUSE_PRESS, button: GHOSTTY_MOUSE_RIGHT, event: event)
    }

    override func rightMouseUp(with event: NSEvent) {
        sendMouseButton(state: GHOSTTY_MOUSE_RELEASE, button: GHOSTTY_MOUSE_RIGHT, event: event)
    }

    override func otherMouseDown(with event: NSEvent) {
        sendMouseButton(
            state: GHOSTTY_MOUSE_PRESS,
            button: GhosttyInputSupport.mouseButton(from: event.buttonNumber),
            event: event
        )
    }

    override func otherMouseUp(with event: NSEvent) {
        sendMouseButton(
            state: GHOSTTY_MOUSE_RELEASE,
            button: GhosttyInputSupport.mouseButton(from: event.buttonNumber),
            event: event
        )
    }

    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        sendMousePosition(event)
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        guard let surfaceStorage else { return }
        ghostty_surface_mouse_pos(
            surfaceStorage,
            -1,
            -1,
            GhosttyInputSupport.ghosttyMods(from: event.modifierFlags)
        )
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        sendMousePosition(event)
    }

    override func mouseDragged(with event: NSEvent) {
        super.mouseDragged(with: event)
        sendMousePosition(event)
    }

    override func rightMouseDragged(with event: NSEvent) {
        super.rightMouseDragged(with: event)
        sendMousePosition(event)
    }

    override func otherMouseDragged(with event: NSEvent) {
        super.otherMouseDragged(with: event)
        sendMousePosition(event)
    }

    override func scrollWheel(with event: NSEvent) {
        guard let surfaceStorage else { return }
        ghostty_surface_mouse_scroll(
            surfaceStorage,
            event.scrollingDeltaX,
            event.scrollingDeltaY,
            ghostty_input_scroll_mods_t(GhosttyInputSupport.ghosttyMods(from: event.modifierFlags).rawValue)
        )
    }

    override func pressureChange(with event: NSEvent) {
        super.pressureChange(with: event)
        guard let surfaceStorage else { return }
        ghostty_surface_mouse_pressure(surfaceStorage, UInt32(event.stage), Double(event.pressure))
    }

    @objc func copy(_ sender: Any?) {
        runBindingAction("copy_to_clipboard")
    }

    @objc func paste(_ sender: Any?) {
        runBindingAction("paste_from_clipboard")
    }

    override func selectAll(_ sender: Any?) {
        runBindingAction("select_all")
    }

    func updateMouseShape(_ shape: ghostty_action_mouse_shape_e) {
        let cursor: NSCursor
        switch shape {
        case GHOSTTY_MOUSE_SHAPE_TEXT:
            cursor = .iBeam
        case GHOSTTY_MOUSE_SHAPE_POINTER:
            cursor = .pointingHand
        case GHOSTTY_MOUSE_SHAPE_CROSSHAIR:
            cursor = .crosshair
        case GHOSTTY_MOUSE_SHAPE_NOT_ALLOWED:
            cursor = .operationNotAllowed
        case GHOSTTY_MOUSE_SHAPE_W_RESIZE, GHOSTTY_MOUSE_SHAPE_E_RESIZE, GHOSTTY_MOUSE_SHAPE_EW_RESIZE:
            cursor = .resizeLeftRight
        case GHOSTTY_MOUSE_SHAPE_N_RESIZE, GHOSTTY_MOUSE_SHAPE_S_RESIZE, GHOSTTY_MOUSE_SHAPE_NS_RESIZE:
            cursor = .resizeUpDown
        default:
            cursor = .arrow
        }

        cursor.set()
    }

    func updateMouseVisibility(_ visible: Bool) {
        NSCursor.setHiddenUntilMouseMoves(!visible)
    }

    private func createSurface() {
        guard let runtime else { return }

        var config = ghostty_surface_config_new()
        config.platform_tag = GHOSTTY_PLATFORM_MACOS
        config.platform = ghostty_platform_u(macos: ghostty_platform_macos_s(nsview: Unmanaged.passUnretained(self).toOpaque()))
        config.userdata = Unmanaged.passUnretained(self).toOpaque()
        config.scale_factor = Double(window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2)
        config.context = GHOSTTY_SURFACE_CONTEXT_WINDOW

        session.workingDirectory.withCString { workingDirectory in
            config.working_directory = workingDirectory
            session.command.withCString { command in
                config.command = command
                surfaceStorage = ghostty_surface_new(runtime.app, &config)
            }
        }
    }

    private func syncGeometry() {
        guard let surfaceStorage else { return }

        let backingBounds = convertToBacking(bounds)
        let width = max(Int(backingBounds.width.rounded(.down)), 1)
        let height = max(Int(backingBounds.height.rounded(.down)), 1)
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let size = CGSize(width: width, height: height)

        guard size != lastSurfaceSize || scale != lastSurfaceScale else {
            return
        }

        lastSurfaceSize = size
        lastSurfaceScale = scale
        ghostty_surface_set_content_scale(surfaceStorage, scale, scale)
        ghostty_surface_set_size(surfaceStorage, UInt32(width), UInt32(height))
    }

    private func syncWindowMetadata() {
        guard let surfaceStorage,
              let screenNumber = window?.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return
        }

        ghostty_surface_set_display_id(surfaceStorage, screenNumber.uint32Value)
    }

    private func syncFocus() {
        guard let surfaceStorage else { return }
        let isFocused = window?.isKeyWindow == true && window?.firstResponder === self
        ghostty_surface_set_focus(surfaceStorage, isFocused)
    }

    private func configureWindowObservers() {
        windowObserverController.configure(
            for: window,
            onDidBecomeKey: { [weak self] in
                self?.syncFocus()
            },
            onDidResignKey: { [weak self] in
                self?.syncFocus()
            },
            onDidChangeScreen: { [weak self] in
                self?.syncWindowMetadata()
                self?.syncGeometry()
            }
        )
    }

    private func sendMousePosition(_ event: NSEvent) {
        guard let surfaceStorage else { return }
        let point = convert(event.locationInWindow, from: nil)
        let y = bounds.height - point.y
        ghostty_surface_mouse_pos(
            surfaceStorage,
            point.x,
            y,
            GhosttyInputSupport.ghosttyMods(from: event.modifierFlags)
        )
    }

    private func sendMouseButton(
        state: ghostty_input_mouse_state_e,
        button: ghostty_input_mouse_button_e,
        event: NSEvent
    ) {
        guard let surfaceStorage else { return }
        ghostty_surface_mouse_button(
            surfaceStorage,
            state,
            button,
            GhosttyInputSupport.ghosttyMods(from: event.modifierFlags)
        )
    }

    @discardableResult
    private func sendKeyAction(
        _ action: ghostty_input_action_e,
        event: NSEvent,
        translationEvent: NSEvent? = nil
    ) -> Bool {
        guard let surfaceStorage else { return false }

        let effectiveEvent = translationEvent ?? event
        var keyEvent = event.ghosttyKeyEvent(action, translationMods: effectiveEvent.modifierFlags)

        if let text = effectiveEvent.ghosttyCharacters,
           let codepoint = text.utf8.first,
           codepoint >= 0x20 {
            return text.withCString { pointer in
                keyEvent.text = pointer
                return ghostty_surface_key(surfaceStorage, keyEvent)
            }
        }

        keyEvent.text = nil
        return ghostty_surface_key(surfaceStorage, keyEvent)
    }

    private func runBindingAction(_ action: String) {
        guard let surfaceStorage else { return }
        _ = action.withCString { pointer in
            ghostty_surface_binding_action(surfaceStorage, pointer, UInt(action.utf8.count))
        }
    }

    private func cleanUp() {
        guard !didCleanUp else { return }
        didCleanUp = true
        windowObserverController.removeAll()
        lastSurfaceSize = nil
        lastSurfaceScale = nil
        if let surfaceStorage {
            ghostty_surface_free(surfaceStorage)
            self.surfaceStorage = nil
        }
    }
}
