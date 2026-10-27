import AppKit
import Foundation

/// The one installed app this helper may drive, and read-only discovery of installed apps.
enum Target {
  /// App bundle chosen by the person; set once at launch.
  static var url = URL(fileURLWithPath: "/")
  /// The running instance of that bundle.
  static var app: NSRunningApplication?

  /// Run a system tool with no shell and no input, returning its exit status and output.
  static func tool(_ path: String, _ args: [String]) -> (status: Int32, output: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = args
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    process.standardInput = FileHandle.nullDevice
    do { try process.run() } catch { return (127, "") }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(decoding: data, as: UTF8.self))
  }

  /// Name, identifier, and version from an app bundle's Info.plist.
  static func describe(_ url: URL) -> [String: String]? {
    guard let info = Bundle(url: url)?.infoDictionary, let identifier = info["CFBundleIdentifier"] as? String else {
      return nil
    }
    return [
      "path": url.path,
      "name": (info["CFBundleDisplayName"] ?? info["CFBundleName"]) as? String ?? url.deletingPathExtension().lastPathComponent,
      "identifier": identifier,
      "version": "\(info["CFBundleShortVersionString"] as? String ?? "?") (\(info["CFBundleVersion"] as? String ?? "?"))",
    ]
  }

  /// Apps in /Applications and ~/Applications, one folder deep, sorted by name.
  static func installedApps() -> [[String: String]] {
    let manager = FileManager.default
    var found: [URL] = []
    for root in ["/Applications", NSHomeDirectory() + "/Applications"] {
      for item in (try? manager.contentsOfDirectory(at: URL(fileURLWithPath: root), includingPropertiesForKeys: nil)) ?? [] {
        if item.pathExtension == "app" { found.append(item) }
        else if (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
          found += ((try? manager.contentsOfDirectory(at: item, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "app" }
        }
      }
    }
    return found.compactMap(describe).sorted { $0["name"]!.localizedCaseInsensitiveCompare($1["name"]!) == .orderedAscending }
  }

  /// Identity of the chosen app as installed right now, including its signing Team ID.
  static func identity() throws -> [String: String] {
    guard var info = describe(url) else { throw DesktopError("The chosen app is not installed at \(url.path).") }
    let details = tool("/usr/bin/codesign", ["-dv", "--verbose=2", url.path]).output
    let team = details.split(separator: "\n").first { $0.hasPrefix("TeamIdentifier=") }.map { String($0.dropFirst(15)) }
    let trusted = tool("/usr/sbin/spctl", ["--assess", "--type", "execute", url.path]).status == 0
    let apple = details.contains("Authority=Software Signing")
    info["signer"] = team.flatMap { $0 == "not set" ? nil : $0 } ?? (apple ? "Apple" : "Unsigned")
    info["signature"] = trusted ? "trusted" : "unsigned"
    return info
  }

  /// Attach to the running app, or open it, and wait for a window to observe.
  static func open() throws -> [String: String] {
    let identity = try identity()
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: identity["identifier"]!)
    if let current = running.first(where: { $0.bundleURL?.standardizedFileURL == url.standardizedFileURL }) ?? running.first {
      app = current
    } else {
      let done = DispatchSemaphore(value: 0)
      var launched: NSRunningApplication?
      let configuration = NSWorkspace.OpenConfiguration()
      configuration.activates = true
      NSWorkspace.shared.openApplication(at: url, configuration: configuration) { opened, _ in
        launched = opened
        done.signal()
      }
      if done.wait(timeout: .now() + 60) == .timedOut || launched == nil { throw DesktopError("The app did not open.") }
      app = launched
    }
    Driver.enableAccessibility()
    for _ in 0..<30 where Driver.window() == nil { Thread.sleep(forTimeInterval: 1) }
    return identity
  }
}
