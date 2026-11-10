import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import type { DeviceBundle, RoutePoint, VehicleIcon } from "../types";
import "leaflet/dist/leaflet.css";

interface Props {
  devices: DeviceBundle[];
  route?: RoutePoint[];
  selectedId?: string | null;
  onSelectDevice?: (bundle: DeviceBundle) => void;
  onOpenDetails?: (bundle: DeviceBundle) => void;
}

export const VEHICLE_ICON_OPTIONS: Array<{ id: VehicleIcon; label: string; typeDefault: string }> = [
  { id: "car", label: "سيارة سيدان", typeDefault: "CAR" },
  { id: "suv", label: "سيارة دفع رباعي", typeDefault: "CAR" },
  { id: "van", label: "فان نقل", typeDefault: "VAN" },
  { id: "truck", label: "شاحنة", typeDefault: "TRUCK" },
  { id: "pickup", label: "بيك أب", typeDefault: "TRUCK" },
  { id: "bus", label: "حافلة", typeDefault: "BUS" },
  { id: "motorcycle", label: "دراجة نارية", typeDefault: "MOTORCYCLE" },
  { id: "tractor", label: "معدات ثقيلة", typeDefault: "EQUIPMENT" }
];

export function getVehicleSvgMarkup(icon: string | undefined, strokeColor = "currentColor"): string {
  switch (icon) {
    case "motorcycle":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h3l2 5"/><path d="M5.5 17.5L9 11h6l3.5 6.5"/><path d="M9 11L7 8H4"/></svg>`;
    case "truck":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="14" height="13" rx="1"/><polygon points="15 8 19 8 23 12 23 16 15 16 15 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
    case "pickup":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h7V7h5l3 5h5v4H2z"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
    case "bus":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 11h18"/><path d="M8 3v8"/><path d="M16 3v8"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg>`;
    case "van":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13l4 5v6H3z"/><path d="M13 6v5h7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`;
    case "tractor":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V5h6l2 6h7v5"/><circle cx="7" cy="17" r="4"/><circle cx="18" cy="18" r="2.5"/></svg>`;
    case "suv":
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l2-6h12l3 6v4H3z"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="17" cy="17.5" r="2.5"/></svg>`;
    case "car":
    default:
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l2-5h10l2 5"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>`;
  }
}

function buildVehicleLeafletIcon(iconKey: string | undefined, online: boolean, selected: boolean) {
  const border = selected ? "#d8b46c" : online ? "#34c99a" : "#76859b";
  const bg = selected ? "#2a2315" : online ? "#11332c" : "#182336";
  const fg = selected ? "#f4d799" : online ? "#65e4b8" : "#b5c2d6";
  const svg = getVehicleSvgMarkup(iconKey, fg);
  return L.divIcon({
    className: "velotrack-marker-wrapper",
    html: `<div style="width:36px;height:36px;border-radius:12px;background:${bg};border:2px solid ${border};display:grid;place-items:center;box-shadow:0 6px 16px rgba(0,0,0,0.45);transform:${
      selected ? "scale(1.14)" : "scale(1)"
    }">${svg}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
  });
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);
  return null;
}

function formatStatusAr(status?: string) {
  const map: Record<string, string> = {
    ONLINE_GPS_FIX: "متصل · GPS",
    ONLINE_NO_GPS_FIX: "متصل · بدون إشارة GPS",
    OFFLINE: "غير متصل",
    ACTIVE: "اشتراك نشط",
    AWAITING_FIRST_CONNECTION: "بانتظار أول اتصال",
    EXPIRED: "اشتراك منتهي",
    SUSPENDED: "اشتراك موقوف"
  };
  return map[status ?? ""] ?? status ?? "—";
}

export default function MapPanel({
  devices,
  route = [],
  selectedId,
  onSelectDevice,
  onOpenDetails
}: Props) {
  const located = devices.filter(
    ({ device }) =>
      device.hasValidFix &&
      typeof device.lastLat === "number" &&
      Number.isFinite(device.lastLat) &&
      typeof device.lastLng === "number" &&
      Number.isFinite(device.lastLng)
  );
  const routeCoords = route
    .filter((p) => p.valid && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .map((p) => [p.latitude, p.longitude] as [number, number]);

  const points = routeCoords.length
    ? routeCoords
    : located.map((x) => [x.device.lastLat as number, x.device.lastLng as number] as [number, number]);
  const center: [number, number] = points[0] ?? [30.0444, 31.2357];

  if (!points.length) {
    return (
      <div className="map-empty">
        <div className="map-empty-grid" />
        <div className="map-empty-content">
          <span className="map-empty-icon">
            <span className="live-dot" />
          </span>
          <strong>لا توجد مواقع مستلمة</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <MapContainer center={center} zoom={6} scrollWheelZoom className="map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {located.map((bundle) => {
          const { device, customer, subscription } = bundle;
          const online = (device.connectionState ?? "").startsWith("ONLINE");
          const isSelected = selectedId === device.id;
          return (
            <Marker
              key={device.id}
              position={[device.lastLat as number, device.lastLng as number]}
              icon={buildVehicleLeafletIcon(device.vehicleIcon, online, isSelected)}
              eventHandlers={{
                click: () => {
                  if (onSelectDevice) onSelectDevice(bundle);
                }
              }}
            >
              <Popup>
                <div className="map-popup-card" dir="rtl">
                  <b>{device.vehicleName}</b>
                  <small>{device.plateNumber || device.imei}</small>
                  {customer?.fullName && <small>العميل: {customer.fullName}</small>}
                  <div className="map-popup-meta">
                    <span>{formatStatusAr(device.connectionState)}</span>
                    <span>{Math.round(device.lastSpeedKmh ?? 0)} كم/س</span>
                  </div>
                  <div className="map-popup-meta">
                    <span>{formatStatusAr(subscription?.status)}</span>
                    <span>
                      {device.lastSeenAtMs
                        ? new Intl.DateTimeFormat("ar-EG", {
                            dateStyle: "short",
                            timeStyle: "short"
                          }).format(new Date(device.lastSeenAtMs))
                        : "—"}
                    </span>
                  </div>
                  {onOpenDetails && (
                    <button
                      type="button"
                      className="map-popup-btn"
                      onClick={() => onOpenDetails(bundle)}
                    >
                      تفاصيل المركبة والتحكم
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {routeCoords.length > 1 && (
          <Polyline
            positions={routeCoords}
            pathOptions={{ color: "#d6b36a", weight: 4, opacity: 0.85 }}
          />
        )}
      </MapContainer>
      <div className="map-attribution">© OpenStreetMap</div>
    </div>
  );
}
