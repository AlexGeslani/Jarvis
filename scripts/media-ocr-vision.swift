import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    fputs("usage: media-ocr-vision IMAGE\n", stderr)
    exit(2)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path) else {
    fputs("unable to decode image\n", stderr)
    exit(3)
}
var rect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    fputs("unable to create image representation\n", stderr)
    exit(4)
}

var lines: [String] = []
let request = VNRecognizeTextRequest { request, error in
    if error != nil { return }
    for observation in request.results as? [VNRecognizedTextObservation] ?? [] {
        if let candidate = observation.topCandidates(1).first {
            lines.append(candidate.string)
        }
    }
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("OCR failed\n", stderr)
    exit(5)
}

print(lines.joined(separator: "\n"))
