import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Run from imind/app: swift tool/generate_app_icons.swift
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("assets/branding/icon.png")
// Render the vector master before generating platform sizes, avoiding raster upscaling.
let rasterizer = Process()
rasterizer.executableURL = URL(fileURLWithPath: "/usr/bin/env")
rasterizer.arguments = ["rsvg-convert", "--width", "2048", "--height", "2048",
                        "--output", sourceURL.path,
                        root.appendingPathComponent("assets/branding/icon.svg").path]
try rasterizer.run()
rasterizer.waitUntilExit()
precondition(rasterizer.terminationStatus == 0, "Install librsvg to render the vector icon")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Unable to load branding icon")
}

func render(_ path: String, size: Int, opaque: Bool, imageFraction: Double) throws {
    let url = root.appendingPathComponent(path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let alpha = opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast
    guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                                  bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: alpha.rawValue) else {
        fatalError("Unable to create icon context")
    }
    if opaque {
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    }
    context.interpolationQuality = .high
    let side = Double(size) * imageFraction
    let inset = (Double(size) - side) / 2
    context.draw(image, in: CGRect(x: inset, y: inset, width: side, height: side))
    guard let output = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Unable to write icon")
    }
    CGImageDestinationAddImage(destination, output, nil)
    precondition(CGImageDestinationFinalize(destination))
}

let catalog = "ios/Runner/Assets.xcassets/AppIcon.appiconset"
let contents = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("\(catalog)/Contents.json"))) as! [String: Any]
var rendered = Set<String>()
for item in contents["images"] as! [[String: String]] {
    let filename = item["filename"]!
    if !rendered.insert(filename).inserted { continue }
    let points = Double(item["size"]!.split(separator: "x")[0])!
    let scale = Double(item["scale"]!.dropLast())!
    try render("\(catalog)/\(filename)", size: Int(points * scale), opaque: true, imageFraction: 0.88)
}

for (density, scale) in [("mdpi", 1.0), ("hdpi", 1.5), ("xhdpi", 2.0), ("xxhdpi", 3.0), ("xxxhdpi", 4.0)] {
    let directory = "android/app/src/main/res/mipmap-\(density)"
    try render("\(directory)/ic_launcher.png", size: Int(48 * scale), opaque: true, imageFraction: 0.88)
    // Android masks the 108dp adaptive layers; keep the mark in the 66dp safe zone.
    try render("\(directory)/ic_launcher_foreground.png", size: Int(108 * scale), opaque: false, imageFraction: 64.0 / 108.0)
}
print("Generated \(rendered.count) iOS icons, 5 Android icons and 5 adaptive foregrounds.")
