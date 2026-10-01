import Foundation
import Vision
import AppKit

do {
    guard CommandLine.arguments.count == 2,
          let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "MyStock", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot decode chart image"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    request.regionOfInterest = CGRect(x: 0, y: 0.82, width: 1, height: 0.18)
    try VNImageRequestHandler(cgImage: cg).perform([request])
    let rows = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return ["text": candidate.string, "confidence": candidate.confidence,
                "x": observation.boundingBox.minX, "y": observation.boundingBox.minY]
    }
    let data = try JSONSerialization.data(withJSONObject: rows)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data(error.localizedDescription.utf8))
    exit(1)
}
