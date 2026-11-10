import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from "react-leaflet";
import type { DeviceBundle, RoutePoint } from "../types";
import "leaflet/dist/leaflet.css";

interface Props {
  devices: DeviceBundle[];
  route?: RoutePoint[];
  selectedId?: string | null;
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);
  return null;
}

export default function MapPanel({ devices, route = [], selectedId }: Props) {
  const located = devices.filter(({ device }) =>
    device.hasValidFix &&
    typeof device.lastLat === "number" && Number.isFinite(device.lastLat) &&
    typeof device.lastLng === "number" && Number.isFinite(device.lastLng)
  );
  const routeCoords = route
    .filter((p) => p.valid && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .map((p) => [p.latitude, p.longitude] as [number, number]);

  const points = routeCoords.length
    ? routeCoords
    : located.map((x) => [x.device.lastLat as number, x.device.lastLng as number] as [number, number]);
  const center: [number, number] = points[0] ?? [20, 0];

  if (!points.length) {
    return (
      <div className="map-empty">
        <div className="map-empty-grid" />
        <div className="map-empty-content">
          <span className="map-empty-icon"><span className="live-dot" /></span>
          <strong>لا توجد مواقع مستلمة</strong>
          <small>ستظهر المواقع بعد استقبال إحداثيات حقيقية من الأجهزة</small>
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
        {located.map(({ device, customer }) => (
          <CircleMarker
            key={device.id}
            center={[device.lastLat as number, device.lastLng as number]}
            radius={selectedId === device.id ? 10 : 7}
            pathOptions={{
              color: selectedId === device.id ? "#d6b36a" : "#38c89a",
              fillColor: selectedId === device.id ? "#d6b36a" : "#38c89a",
              fillOpacity: 0.9,
              weight: 2
            }}
          >
            <Popup>
              <b>{device.vehicleName}</b><br />
              {customer?.fullName ?? device.plateNumber}<br />
              {device.lastSpeedKmh ?? 0} كم/س
            </Popup>
          </CircleMarker>
        ))}
        {routeCoords.length > 1 && (
          <Polyline positions={routeCoords} pathOptions={{ color: "#d6b36a", weight: 4, opacity: 0.85 }} />
        )}
      </MapContainer>
      <div className="map-attribution">© OpenStreetMap</div>
    </div>
  );
}
