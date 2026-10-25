// Aiden desktop helper: drives one installed app on this Mac for acceptance checks. It is bound to
// the app given at launch and never reads or acts on any other app.
//
//   aiden-desktop check              Print whether Accessibility and Screen Recording are allowed.
//   aiden-desktop request            Ask macOS for both permissions, then print the check.
//   aiden-desktop apps               List installed apps.
//   aiden-desktop drive --app <path> Answer one JSON request per stdin line with one stdout line.

import AppKit
import ApplicationServices
import Foundation

/// A request failure the host shows to the model or the person.
struct DesktopError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// Print one JSON value on its own line.
func emit(_ value: Any) {
  guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

/// Current permission state for the process that launched this helper.
func permissions() -> [String: Bool] {
  ["accessibility": AXIsProcessTrusted(), "screenCapture": CGPreflightScreenCaptureAccess()]
}

/// Read a required whole number from a request.
func integer(_ request: [String: Any], _ key: String) throws -> Int {
  guard let value = request[key] as? Int else { throw DesktopError("Missing \(key).") }
  return value
}

/// Read a required normalized coordinate from a request.
func number(_ request: [String: Any], _ key: String) throws -> Double {
  guard let value = request[key] as? Double, value >= 0, value <= 1 else { throw DesktopError("Invalid \(key).") }
  return value
}

/// Dispatch one request to the matching operation; unknown operations are refused.
func handle(_ request: [String: Any]) throws -> Any? {
  switch request["op"] as? String {
  case "open": return try Target.open()
  case "identity": return try Target.identity()
  case "observe": return try Driver.observe()
  case "click": try Driver.click(element: integer(request, "element")); return nil
  case "click_point": try Driver.clickPoint(x: number(request, "x"), y: number(request, "y")); return nil
  case "type": try Driver.type(element: integer(request, "element"), text: request["text"] as? String ?? ""); return nil
  case "key": try Driver.key(request["key"] as? String ?? ""); return nil
  case "scroll": try Driver.scroll(direction: request["direction"] as? String ?? "", element: request["element"] as? Int); return nil
  default: throw DesktopError("Unknown operation.")
  }
}

/// Answer requests in order until the host closes stdin.
func serve() {
  while let line = readLine(strippingNewline: true) {
    guard line.utf8.count < 100_000, let data = line.data(using: .utf8),
      let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let id = request["id"] as? Int
    else {
      emit(["id": -1, "ok": false, "error": "Malformed request."])
      continue
    }
    do {
      let result = try handle(request)
      emit(result.map { ["id": id, "ok": true, "data": $0] } ?? ["id": id, "ok": true])
    } catch let error as DesktopError {
      emit(["id": id, "ok": false, "error": String(error.message.prefix(500))])
    } catch {
      emit(["id": id, "ok": false, "error": "The app could not finish this action."])
    }
  }
  exit(0)
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "check":
  emit(permissions())
case "request":
  _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
  if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
  emit(permissions())
case "apps":
  emit(Target.installedApps())
case "drive":
  guard arguments.count == 3, arguments[1] == "--app" else {
    emit(["id": -1, "ok": false, "error": "Use drive --app /Applications/Name.app."])
    exit(2)
  }
  Target.url = URL(fileURLWithPath: arguments[2], isDirectory: true)
  _ = NSApplication.shared
  // ScreenCaptureKit and AppKit callbacks need a live main queue, so requests run on a worker thread.
  Thread { serve() }.start()
  dispatchMain()
default:
  emit(["error": "Unknown command."])
  exit(2)
}
