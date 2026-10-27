import AppKit
import ApplicationServices
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Observe and drive the chosen app through Accessibility. Pointer events are a fallback that first
/// brings the app forward and only lands inside its window.
enum Driver {
  /// Elements from the latest observation, indexed by the ids the model was given.
  static var elements: [Int: AXUIElement] = [:]
  static let interesting: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXTextField", "AXTextArea",
    "AXSearchField", "AXComboBox", "AXSlider", "AXLink", "AXTab", "AXCell", "AXRow", "AXMenuItem",
    "AXDisclosureTriangle", "AXIncrementor", "AXStaticText", "AXHeading", "AXImage", "AXSwitch", "AXToggle",
  ]

  /// The running app. After an update relaunches it, re-attach to the new instance of the same bundle.
  static func running() throws -> NSRunningApplication {
    if let app = Target.app, !app.isTerminated { return app }
    let identifier = Bundle(url: Target.url)?.bundleIdentifier ?? ""
    guard let relaunched = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
      .first(where: { $0.bundleURL?.standardizedFileURL == Target.url.standardizedFileURL })
    else { throw DesktopError("The app is not running. Open it again.") }
    Target.app = relaunched
    enableAccessibility()
    return relaunched
  }

  /// The app's accessibility root.
  static func root() throws -> AXUIElement {
    AXUIElementCreateApplication(try running().processIdentifier)
  }

  /// Turn on the full accessibility tree in Chromium and Electron apps.
  static func enableAccessibility() {
    guard let element = try? root() else { return }
    AXUIElementSetAttributeValue(element, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  }

  /// Read one accessibility attribute.
  static func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value as? T
  }

  /// The app's focused window, falling back to its first window.
  static func window() -> AXUIElement? {
    guard let app = try? root() else { return nil }
    if let focused: AXUIElement = attribute(app, kAXFocusedWindowAttribute) { return focused }
    let windows: [AXUIElement] = attribute(app, kAXWindowsAttribute) ?? []
    return windows.first
  }

  /// Screen-space frame of an element, in points with a top-left origin.
  static func frame(_ element: AXUIElement) -> CGRect? {
    guard let position: AXValue = attribute(element, kAXPositionAttribute),
      let size: AXValue = attribute(element, kAXSizeAttribute)
    else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    AXValueGetValue(position, .cgPoint, &point)
    AXValueGetValue(size, .cgSize, &extent)
    return CGRect(origin: point, size: extent)
  }

  /// The window to observe and its frame; every coordinate the model sees is relative to it.
  static func currentWindow() throws -> (AXUIElement, CGRect) {
    guard let window = window(), let box = frame(window), box.width > 0, box.height > 0 else {
      throw DesktopError("The app has no open window.")
    }
    return (window, box)
  }

  /// Capture only this app's window, even when other windows cover it, as PNG bytes.
  static func capture(_ box: CGRect) throws -> Data {
    let pid = try running().processIdentifier
    var outcome: Result<CGImage, Error> = .failure(DesktopError("Screen capture did not finish."))
    let done = DispatchSemaphore(value: 0)
    Task {
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
        guard let match = windows.min(by: { distance($0.frame, box) < distance($1.frame, box) }) else {
          throw DesktopError("The app window could not be captured.")
        }
        let filter = SCContentFilter(desktopIndependentWindow: match)
        let config = SCStreamConfiguration()
        config.width = Int(match.frame.width * CGFloat(filter.pointPixelScale))
        config.height = Int(match.frame.height * CGFloat(filter.pointPixelScale))
        config.showsCursor = false
        outcome = .success(try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config))
      } catch {
        outcome = .failure(error)
      }
      done.signal()
    }
    if done.wait(timeout: .now() + 20) == .timedOut { throw DesktopError("Screen capture timed out.") }
    guard case .success(let image) = outcome else { throw DesktopError("Allow Screen Recording for Aiden to capture the app.") }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
      throw DesktopError("The screenshot could not be encoded.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw DesktopError("The screenshot could not be encoded.") }
    return data as Data
  }

  /// Distance between two frames' origins, used to match accessibility and capture windows.
  static func distance(_ a: CGRect, _ b: CGRect) -> CGFloat {
    abs(a.minX - b.minX) + abs(a.minY - b.minY) + abs(a.width - b.width) + abs(a.height - b.height)
  }

  /// Capture the window and its accessible elements, numbering them for this observation.
  static func observe() throws -> [String: Any] {
    guard AXIsProcessTrusted() else { throw DesktopError("Allow Accessibility for Aiden to read the app.") }
    let app = try running()
    let (window, box) = try currentWindow()
    elements = [:]
    var list: [[String: Any]] = []
    var stack: [(AXUIElement, Int)] = [(window, 0)]
    while let (element, depth) = stack.popLast(), list.count < 400 {
      if let item = describe(element, in: box, id: list.count + 1) {
        elements[list.count + 1] = element
        list.append(item)
      }
      if depth < 30 {
        let children: [AXUIElement] = attribute(element, kAXChildrenAttribute) ?? []
        for child in children.reversed() { stack.append((child, depth + 1)) }
      }
    }
    return [
      "app": app.localizedName ?? "",
      "window": attribute(window, kAXTitleAttribute) as String? ?? "",
      "foreground": NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
      "elements": list,
      "screenshot": try capture(box).base64EncodedString(),
    ]
  }

  /// One element as the model sees it, with its frame relative to the window; nil when not useful.
  static func describe(_ element: AXUIElement, in box: CGRect, id: Int) -> [String: Any]? {
    let role: String = attribute(element, kAXRoleAttribute) ?? ""
    let title: String = attribute(element, kAXTitleAttribute) ?? attribute(element, kAXDescriptionAttribute) ?? ""
    let text = (attribute(element, kAXValueAttribute) as Any?) as? String ?? ""
    guard interesting.contains(role), !(role == "AXStaticText" && title.isEmpty && text.isEmpty),
      let rect = frame(element), rect.width > 0, rect.intersects(box)
    else { return nil }
    let secure = (attribute(element, kAXSubroleAttribute) as String?) == "AXSecureTextField"
    var item: [String: Any] = [
      "id": id,
      "role": String(role.dropFirst(2).prefix(80)),
      "name": String((title.isEmpty && role == "AXStaticText" ? text : title).prefix(300)),
      "enabled": attribute(element, kAXEnabledAttribute) ?? true,
      "frame": [
        (rect.minX - box.minX) / box.width, (rect.minY - box.minY) / box.height,
        rect.width / box.width, rect.height / box.height,
      ],
    ]
    if secure { item["secure"] = true } else if !text.isEmpty, role != "AXStaticText" { item["value"] = String(text.prefix(300)) }
    return item
  }

  /// An element from the latest observation.
  static func element(_ id: Int) throws -> AXUIElement {
    guard let element = elements[id] else { throw DesktopError("Unknown element. Observe again.") }
    return element
  }

  /// Press an element through Accessibility, which works without bringing the app forward.
  static func click(element id: Int) throws {
    let target = try element(id)
    if AXUIElementPerformAction(target, kAXPressAction as CFString) == .success { return }
    guard let rect = frame(target) else { throw DesktopError("The element has no position.") }
    try pointer(CGPoint(x: rect.midX, y: rect.midY)) { point in
      for type in [CGEventType.leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.05)
      }
    }
  }

  /// Click normalized coordinates within the app window from the latest screenshot.
  static func clickPoint(x: Double, y: Double) throws {
    let (_, box) = try currentWindow()
    try pointer(CGPoint(x: box.minX + x * box.width, y: box.minY + y * box.height)) { point in
      for type in [CGEventType.leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.05)
      }
    }
  }

  /// Pointer events reach whatever is on screen, so bring the app forward and stay inside its window.
  static func pointer(_ point: CGPoint, _ post: (CGPoint) -> Void) throws {
    let app = try running()
    if NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier {
      app.activate()
      Thread.sleep(forTimeInterval: 0.5)
    }
    let (_, box) = try currentWindow()
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier, box.contains(point) else {
      throw DesktopError("The app is not in front, so Aiden did not click.")
    }
    post(point)
  }

  /// Replace a field's text; secure fields are refused here as well as on the host.
  static func type(element id: Int, text: String) throws {
    let target = try element(id)
    if (attribute(target, kAXSubroleAttribute) as String?) == "AXSecureTextField" {
      throw DesktopError("Password fields need manual sign-in before testing.")
    }
    AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    if AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, text as CFString) == .success { return }
    let pid = try running().processIdentifier
    keystroke(0, flags: .maskCommand, pid: pid)
    for chunk in stride(from: 0, to: text.utf16.count, by: 20).map({ Array(Array(text.utf16)[$0..<min($0 + 20, text.utf16.count)]) }) {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
      event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      event?.postToPid(pid)
      CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)?.postToPid(pid)
    }
  }

  /// Press one allowed key, delivered to this app only.
  static func key(_ name: String) throws {
    let codes: [String: CGKeyCode] = [
      "Enter": 36, "Tab": 48, "Escape": 53, "Space": 49, "Backspace": 51, "ArrowUp": 126,
      "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124, "PageUp": 116, "PageDown": 121,
    ]
    guard let code = codes[name] else { throw DesktopError("Key not allowed.") }
    keystroke(code, flags: [], pid: try running().processIdentifier)
  }

  /// Post a key down and up to one process.
  static func keystroke(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t) {
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
      event?.flags = flags
      event?.postToPid(pid)
    }
  }

  /// Scroll at an element's center, or the window's center.
  static func scroll(direction: String, element id: Int?) throws {
    let rect = try id.map { try frame(element($0)) } ?? currentWindow().1
    guard let rect else { throw DesktopError("Nothing to scroll.") }
    let (dy, dx): (Int32, Int32) = switch direction {
    case "up": (5, 0)
    case "down": (-5, 0)
    case "left": (0, 5)
    case "right": (0, -5)
    default: throw DesktopError("Invalid direction.")
    }
    try pointer(CGPoint(x: rect.midX, y: rect.midY)) { point in
      let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
      event?.location = point
      event?.post(tap: .cghidEventTap)
    }
  }
}
