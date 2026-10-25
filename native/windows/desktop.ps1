# Aiden desktop helper for Windows: drives one installed app for acceptance checks. It is bound to
# the program given at launch and never reads or acts on any other app. It answers one JSON request
# per stdin line with one JSON line on stdout.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop.ps1 -App C:\Path\To\App.exe
param([Parameter(Mandatory = $true)][string]$App)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AidenInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(0x02, 0, 0, 0, UIntPtr.Zero); mouse_event(0x04, 0, 0, 0, UIntPtr.Zero); }
  public static void Wheel(int x, int y, int amount, bool horizontal) { SetCursorPos(x, y); mouse_event(horizontal ? 0x1000u : 0x0800u, 0, 0, amount, UIntPtr.Zero); }
}
'@
[AidenInput]::SetProcessDPIAware() | Out-Null
$script:Elements = @{}
$script:Process = $null

# Name, identifier, version, and publisher of the chosen program as installed right now.
function Get-Identity {
  if (-not (Test-Path -LiteralPath $App)) { throw "The chosen app is not installed at $App." }
  $info = (Get-Item -LiteralPath $App).VersionInfo
  $signature = Get-AuthenticodeSignature -LiteralPath $App
  $signer = 'Unsigned'
  if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match 'CN="?([^",]+)') { $signer = $Matches[1] }
  $name = [IO.Path]::GetFileNameWithoutExtension($App)
  if ($info.ProductName) { $name = $info.ProductName }
  $version = 'Unknown'
  if ($info.ProductVersion) { $version = $info.ProductVersion }
  $trust = 'unsigned'
  if ($signature.Status -eq 'Valid') { $trust = 'trusted' }
  return [ordered]@{ path = $App; name = $name; identifier = [IO.Path]::GetFileName($App); version = $version; signer = $signer; signature = $trust }
}

# The running instance of the chosen program that owns a window.
function Get-Target {
  $full = [IO.Path]::GetFullPath($App)
  $found = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($App)) -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Path -and ([IO.Path]::GetFullPath($_.Path) -eq $full) } |
    Select-Object -First 1
  if (-not $found) { throw 'The app is not running. Open it again.' }
  return $found
}

# Attach to the running program, or start it, and wait for its window.
function Open-Target {
  $identity = Get-Identity
  try { Get-Target | Out-Null } catch { Start-Process -FilePath $App | Out-Null }
  for ($i = 0; $i -lt 60; $i++) {
    try { Get-Target | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
  return $identity
}

# The window rectangle; every coordinate the model sees is relative to it.
function Get-WindowBox($Target) {
  $rect = New-Object AidenInput+RECT
  [AidenInput]::GetWindowRect($Target.MainWindowHandle, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { throw 'The app has no open window.' }
  return @{ X = $rect.Left; Y = $rect.Top; Width = $width; Height = $height }
}

# Capture only the app window, even when other windows cover it, as base64 PNG.
function Get-WindowImage($Target, $Box) {
  $bitmap = New-Object Drawing.Bitmap $Box.Width, $Box.Height
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  [AidenInput]::PrintWindow($Target.MainWindowHandle, $hdc, 2) | Out-Null
  $graphics.ReleaseHdc($hdc)
  $stream = New-Object IO.MemoryStream
  $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  return [Convert]::ToBase64String($stream.ToArray())
}

# Capture the window and its accessible elements, numbering them for this observation.
function Get-Observation {
  $target = Get-Target
  $box = Get-WindowBox $target
  $root = [Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
  $script:Elements = @{}
  $list = New-Object System.Collections.ArrayList
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($root, 0))
  while ($stack.Count -gt 0 -and $list.Count -lt 400) {
    $entry = $stack.Pop(); $node = $entry[0]; $depth = $entry[1]
    try { $current = $node.Current } catch { continue }
    $rect = $current.BoundingRectangle
    if ($node -ne $root -and -not $current.IsOffscreen -and -not $rect.IsEmpty -and $rect.Width -gt 0 -and ($current.Name -or $current.IsKeyboardFocusable)) {
      $id = $list.Count + 1
      $script:Elements[$id] = $node
      $item = [ordered]@{
        id = $id
        role = ($current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        name = [string]$current.Name
        enabled = [bool]$current.IsEnabled
        frame = @((($rect.X - $box.X) / $box.Width), (($rect.Y - $box.Y) / $box.Height), ($rect.Width / $box.Width), ($rect.Height / $box.Height))
      }
      if ($item.name.Length -gt 300) { $item.name = $item.name.Substring(0, 300) }
      if ($current.IsPassword) { $item.secure = $true }
      else {
        $pattern = $null
        if ($node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and $pattern.Current.Value) {
          $value = [string]$pattern.Current.Value
          if ($value.Length -gt 300) { $value = $value.Substring(0, 300) }
          $item.value = $value
        }
      }
      [void]$list.Add($item)
    }
    if ($depth -lt 30) {
      $children = New-Object System.Collections.ArrayList
      $child = $walker.GetFirstChild($node)
      while ($child -and $children.Count -lt 200) { [void]$children.Add($child); $child = $walker.GetNextSibling($child) }
      for ($i = $children.Count - 1; $i -ge 0; $i--) { $stack.Push(@($children[$i], ($depth + 1))) }
    }
  }
  return [ordered]@{
    app = $target.ProcessName
    window = [string]$root.Current.Name
    foreground = ([AidenInput]::GetForegroundWindow() -eq $target.MainWindowHandle)
    elements = $list
    screenshot = (Get-WindowImage $target $box)
  }
}

# An element from the latest observation.
function Get-Element($Id) {
  $element = $script:Elements[[int]$Id]
  if (-not $element) { throw 'Unknown element. Observe again.' }
  return $element
}

# Pointer and keyboard input reach whatever is in front, so bring the app forward first and stay inside its window.
function Use-Foreground($Target, [int]$X, [int]$Y) {
  if ([AidenInput]::GetForegroundWindow() -ne $Target.MainWindowHandle) {
    [AidenInput]::SetForegroundWindow($Target.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 400
  }
  $box = Get-WindowBox $Target
  $inside = $X -ge $box.X -and $Y -ge $box.Y -and $X -lt ($box.X + $box.Width) -and $Y -lt ($box.Y + $box.Height)
  if ([AidenInput]::GetForegroundWindow() -ne $Target.MainWindowHandle -or -not $inside) { throw 'The app is not in front, so Aiden did not act.' }
}

# Invoke, toggle, or select an element; click its center only when it has none of those patterns.
function Invoke-Element($Id) {
  $element = Get-Element $Id
  $pattern = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); return }
  if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); return }
  if ($element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); return }
  $rect = $element.Current.BoundingRectangle
  $x = [int]($rect.X + $rect.Width / 2); $y = [int]($rect.Y + $rect.Height / 2)
  Use-Foreground (Get-Target) $x $y
  [AidenInput]::Click($x, $y)
}

# Replace a field's text; password fields are refused here as well as on the host.
function Set-ElementText($Id, [string]$Text) {
  $element = Get-Element $Id
  if ($element.Current.IsPassword) { throw 'Password fields need manual sign-in before testing.' }
  $pattern = $null
  if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and -not $pattern.Current.IsReadOnly) {
    $pattern.SetValue($Text)
    return
  }
  $rect = $element.Current.BoundingRectangle
  Use-Foreground (Get-Target) ([int]($rect.X + $rect.Width / 2)) ([int]($rect.Y + $rect.Height / 2))
  $element.SetFocus()
  [Windows.Forms.SendKeys]::SendWait('^a')
  [Windows.Forms.SendKeys]::SendWait(($Text -replace '([+^%~(){}\[\]])', '{$1}'))
}

# Window center, used for keys and window-level scrolling.
function Get-Center($Target) {
  $box = Get-WindowBox $Target
  return @([int]($box.X + $box.Width / 2), [int]($box.Y + $box.Height / 2))
}

# Dispatch one request; unknown operations are refused.
function Invoke-Request($Request) {
  switch ([string]$Request.op) {
    'open' { return Open-Target }
    'identity' { return Get-Identity }
    'observe' { return Get-Observation }
    'click' { Invoke-Element $Request.element; return $null }
    'click_point' {
      $target = Get-Target
      $box = Get-WindowBox $target
      $x = [int]($box.X + [double]$Request.x * $box.Width); $y = [int]($box.Y + [double]$Request.y * $box.Height)
      Use-Foreground $target $x $y
      [AidenInput]::Click($x, $y)
      return $null
    }
    'type' { Set-ElementText $Request.element ([string]$Request.text); return $null }
    'key' {
      $keys = @{ Enter = '{ENTER}'; Tab = '{TAB}'; Escape = '{ESC}'; Space = ' '; Backspace = '{BACKSPACE}'; ArrowUp = '{UP}'; ArrowDown = '{DOWN}'; ArrowLeft = '{LEFT}'; ArrowRight = '{RIGHT}'; PageUp = '{PGUP}'; PageDown = '{PGDN}' }
      if (-not $keys.ContainsKey([string]$Request.key)) { throw 'Key not allowed.' }
      $target = Get-Target
      $center = Get-Center $target
      Use-Foreground $target $center[0] $center[1]
      [Windows.Forms.SendKeys]::SendWait($keys[[string]$Request.key])
      return $null
    }
    'scroll' {
      $target = Get-Target
      $center = Get-Center $target
      if ($null -ne $Request.element) {
        $rect = (Get-Element $Request.element).Current.BoundingRectangle
        $center = @([int]($rect.X + $rect.Width / 2), [int]($rect.Y + $rect.Height / 2))
      }
      Use-Foreground $target $center[0] $center[1]
      $amount = @{ up = 360; down = -360; left = -360; right = 360 }[[string]$Request.direction]
      if ($null -eq $amount) { throw 'Invalid direction.' }
      [AidenInput]::Wheel($center[0], $center[1], $amount, ([string]$Request.direction -in 'left', 'right'))
      return $null
    }
    default { throw 'Unknown operation.' }
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $response = [ordered]@{ id = -1 }
  try {
    if ($line.Length -gt 100000) { throw 'Malformed request.' }
    $request = $line | ConvertFrom-Json
    $response.id = [int]$request.id
    $result = Invoke-Request $request
    $response.ok = $true
    if ($null -ne $result) { $response.data = $result }
  } catch {
    $response.ok = $false
    $message = [string]$_.Exception.Message
    if ($message.Length -gt 500) { $message = $message.Substring(0, 500) }
    $response.error = $message
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 8 -Compress))
  [Console]::Out.Flush()
}
