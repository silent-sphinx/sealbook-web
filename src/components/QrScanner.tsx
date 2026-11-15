import { useEffect, useRef, useState } from "react";
import { btnSecondary } from "../lib/styles";
import { ErrorMessage } from "./ErrorMessage";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

/** How often a frame is checked for a code. */
const SCAN_INTERVAL_MS = 250;

/** What a scanned pairing code starts with. Mirrors `PAIR_QR_PREFIX` in sealbook-crypto. */
const PAIR_QR_PREFIX = "SEALBOOK-PAIR:";

/** Whether this browser can open a camera at all, so the option is only offered where it works. */
export function canScan(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/**
 * The browser's own detector where it has one that reads QR codes, otherwise
 * the zxing-wasm ponyfill, loaded only when a scan starts. The ponyfill fetches
 * its wasm from a CDN by default; it is pointed at the copy in this bundle so a
 * scan sends nothing to a third party and fits the content security policy.
 */
async function createDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: {
    new (options: { formats: string[] }): Detector;
    getSupportedFormats(): Promise<string[]>;
  } }).BarcodeDetector;
  if (native && (await native.getSupportedFormats()).includes("qr_code")) {
    return new native({ formats: ["qr_code"] });
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: ["qr_code"] });
}

function cameraMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Camera access was not allowed. Type the eight words instead.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") {
    return "No camera was found. Type the eight words instead.";
  }
  return "The camera couldn't be started. Type the eight words instead.";
}

/**
 * Reads a pairing QR code from the camera. Only a code that starts the way a
 * Sealbook pairing code does is handed on; anything else in view is ignored.
 */
export function QrScanner({ onScan, onCancel }: { onScan: (text: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let stream: MediaStream | undefined;

    const scan = async (detector: Detector, video: HTMLVideoElement) => {
      if (cancelled) return;
      try {
        const found = await detector.detect(video);
        const hit = found.find((code) => code.rawValue.toUpperCase().startsWith(PAIR_QR_PREFIX));
        if (hit && !cancelled) {
          onScanRef.current(hit.rawValue);
          return;
        }
      } catch {
        // A frame that is not ready yet fails to decode; the next one is tried.
      }
      timer = window.setTimeout(() => void scan(detector, video), SCAN_INTERVAL_MS);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = stream;
        await video.play();
        const detector = await createDetector();
        void scan(detector, video);
      } catch (err) {
        if (!cancelled) setError(cameraMessage(err));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-line bg-black">
        <video ref={videoRef} muted playsInline aria-label="Camera view" className="aspect-square w-full object-cover" />
      </div>
      <p className="mt-3 text-xs text-mute text-center">Point the camera at the code on the new device.</p>
      {error ? <ErrorMessage className="mt-3">{error}</ErrorMessage> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Type the words instead
        </button>
      </div>
    </div>
  );
}
