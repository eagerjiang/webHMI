import Foundation
import AVFoundation
import AppKit
import CoreMedia

func fourCC(_ code: FourCharCode) -> String {
    let bytes: [UInt8] = [
        UInt8((code >> 24) & 0xff),
        UInt8((code >> 16) & 0xff),
        UInt8((code >> 8) & 0xff),
        UInt8(code & 0xff),
    ]
    return String(bytes: bytes, encoding: .macOSRoman) ?? String(code)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let framesURL = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
let asset = AVURLAsset(url: inputURL)

guard let videoTrack = asset.tracks(withMediaType: .video).first else {
    fputs("No video track found\n", stderr)
    exit(2)
}

let transformedSize = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
let width = Int(abs(transformedSize.width).rounded())
let height = Int(abs(transformedSize.height).rounded())
let duration = CMTimeGetSeconds(asset.duration)
let codec: String = {
    guard let description = videoTrack.formatDescriptions.first else { return "unknown" }
    return fourCC(CMFormatDescriptionGetMediaSubType(description as! CMFormatDescription))
}()

if FileManager.default.fileExists(atPath: outputURL.path) {
    try FileManager.default.removeItem(at: outputURL)
}

guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
    fputs("Could not create export session\n", stderr)
    exit(3)
}

guard exporter.supportedFileTypes.contains(.mp4) else {
    fputs("MP4 export is not supported for this recording\n", stderr)
    exit(4)
}

exporter.outputURL = outputURL
exporter.outputFileType = .mp4
exporter.shouldOptimizeForNetworkUse = true
let exportDone = DispatchSemaphore(value: 0)
exporter.exportAsynchronously { exportDone.signal() }
exportDone.wait()

guard exporter.status == .completed else {
    fputs("Export failed: \(exporter.error?.localizedDescription ?? "unknown error")\n", stderr)
    exit(5)
}

try FileManager.default.createDirectory(at: framesURL, withIntermediateDirectories: true)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let sampleSeconds = [1.0, 4.0, 8.0, min(15.0, max(0.0, duration - 1.0))]
for (index, second) in sampleSeconds.enumerated() {
    var actual = CMTime.zero
    let image = try generator.copyCGImage(
        at: CMTime(seconds: second, preferredTimescale: 600),
        actualTime: &actual
    )
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fputs("Could not encode frame \(index + 1)\n", stderr)
        exit(6)
    }
    let frameURL = framesURL.appendingPathComponent(String(format: "frame-%02d-%.1fs.png", index + 1, second))
    try png.write(to: frameURL)
}

let attrs = try FileManager.default.attributesOfItem(atPath: outputURL.path)
let bytes = (attrs[.size] as? NSNumber)?.int64Value ?? 0
print(String(format: "duration=%.3f", duration))
print("dimensions=\(width)x\(height)")
print("codec=\(codec)")
print("mp4_bytes=\(bytes)")
print("frames=\(framesURL.path)")
