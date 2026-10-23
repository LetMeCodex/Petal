# Offline OCR with Windows' built-in engine (Windows.Media.Ocr).
# Usage: powershell -File ocr.ps1 <image> [<image> ...]
# Prints JSON: { "lang": "en-US", "results": [ { "path": "...", "text": "..." } ] }  or  { "error": "..." }
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

# WinRT async -> .NET Task, then block on it.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

try {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'No OCR language pack installed. Add one in Settings > Time & language > Language.' }
  $results = foreach ($p in $Paths) {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    [pscustomobject]@{ path = $p; text = (($ocr.Lines | ForEach-Object { $_.Text }) -join "`n") }
  }
  [pscustomobject]@{ lang = $engine.RecognizerLanguage.LanguageTag; results = @($results) } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [pscustomobject]@{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
