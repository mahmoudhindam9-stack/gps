import { useEffect, useRef, useState } from "react";
import { Camera, Check, RefreshCw, X } from "lucide-react";

interface Props {
  onDetected: (value: string) => void;
  onClose: () => void;
}

export function isValidImei15(imei: string): boolean {
  const clean = String(imei ?? "").trim();
  if (!/^\d{15}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = Number(clean[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(clean[14]);
}

export default function BarcodeScannerModal({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [scanning, setScanning] = useState(true);
  const [manualValue, setManualValue] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let cancelled = false;

    async function startCamera() {
      setCameraError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("الكاميرا غير مدعومة في هذا المتصفح");
        setScanning(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setCameraError("الكاميرا تعمل — أدخل الرقم يدويًا أو استخدم متصفحًا يدعم قراءة الباركود المباشرة");
          return;
        }

        const detector = new BarcodeDetectorCtor({
          formats: ["code_128", "code_39", "ean_13", "qr_code", "itf", "codabar"]
        });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            if (videoRef.current.readyState >= 2) {
              const codes = await detector.detect(videoRef.current);
              if (Array.isArray(codes) && codes.length > 0) {
                for (const code of codes) {
                  const raw = String(code.rawValue ?? "").trim();
                  const imeiMatch = raw.match(/\d{15}/);
                  if (imeiMatch && isValidImei15(imeiMatch[0])) {
                    onDetected(imeiMatch[0]);
                    return;
                  }
                  if (raw.length >= 6) {
                    onDetected(raw);
                    return;
                  }
                }
              }
            }
          } catch {
            // continue scanning next frame
          }
          rafId = window.requestAnimationFrame(tick);
        };
        rafId = window.requestAnimationFrame(tick);
      } catch {
        setCameraError("تعذر الوصول إلى الكاميرا — تأكد من منح صلاحية الكاميرا");
        setScanning(false);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal">
        <header className="modal-head">
          <h3>مسح باركود IMEI / الرقم التسلسلي</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </header>
        <div className="modal-form form-stack">
          <div className="scanner-viewport">
            <video ref={videoRef} playsInline muted className="scanner-video" />
            <div className="scanner-frame" />
            <span className="scanner-badge">
              <Camera size={14} /> {scanning ? "وجّه الكاميرا نحو باركود الجهاز" : "إدخال يدوي"}
            </span>
          </div>
          {cameraError && <div className="form-note">{cameraError}</div>}
          <label>
            IMEI أو الرقم التسلسلي
            <input
              dir="ltr"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="358739051122332"
            />
          </label>
          <div className="detail-actions">
            <button
              type="button"
              className="primary-btn full-btn"
              disabled={!manualValue.trim()}
              onClick={() => onDetected(manualValue.trim())}
            >
              <Check size={16} /> اعتماد الرقم
            </button>
            <button type="button" className="secondary-btn" onClick={onClose}>
              <RefreshCw size={15} /> إغلاق
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
