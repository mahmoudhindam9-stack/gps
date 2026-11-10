export type Role = "ADMIN" | "CUSTOMER";

export interface User {
  id: string;
  username?: string | null;
  email: string;
  phone?: string;
  fullName: string;
  role: Role | string;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAtMs: number;
}

export interface Session {
  token: string;
  mustChangePassword: boolean;
  user: User;
}

export interface Subscription {
  id: string;
  deviceId: string;
  customerId: string;
  planDuration: string;
  status: string;
  startedAtMs: number | null;
  expiresAtMs: number | null;
  adminOverrideBy?: string | null;
  adminOverrideReason?: string | null;
}

export interface Device {
  id: string;
  imei: string;
  traccarDeviceId: number;
  profileId: string;
  currentCustomerId: string;
  vehicleName: string;
  plateNumber: string;
  simLocalNumber: string;
  simE164Number: string;
  activationStatus: string;
  connectionState: string;
  hasValidFix: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKmh: number | null;
  lastHeading: number | null;
  ignitionOn: boolean | null;
  firstConnectedAtMs: number | null;
  lastSeenAtMs: number | null;
  createdAtMs: number;
}

export interface DeviceProfile {
  id: string;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  traccarProtocol: string;
  serverHost: string;
  serverPort: number;
  transport: string;
  serverMode: string;
  requiresDevicePassword: boolean;
  defaultDevicePassword?: string | null;
  requiresGprsonCommand: boolean;
  serverCommandTemplate: string;
  gprsonCommandTemplate?: string | null;
  expectedReplyPattern?: string | null;
  isVerified: boolean;
  createdAtMs: number;
}

export interface SmsLog {
  id: string;
  commandKey: string;
  commandText: string;
  status: string;
  deviceReply?: string | null;
  failureReason?: string | null;
  sentAtMs: number;
}

export interface RoutePoint {
  traccarPositionId: number;
  traccarDeviceId: number;
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  valid: boolean;
  ignition: boolean;
  recordedAtMs: number;
}

export interface DeviceBundle {
  device: Device;
  subscription: Subscription | null;
  customer: User | null;
  profile: DeviceProfile | null;
  smsLogs: SmsLog[];
  subscriptionHistory: Array<Record<string, unknown>>;
  ownershipHistory: Array<Record<string, unknown>>;
}

export interface Health {
  status: string;
  supabaseConnected: boolean;
  traccarConnected: boolean;
  traccarWsConnected: boolean;
  traccarLastSyncAtMs?: number | null;
  smsGatewayConfigured: boolean;
  databaseError?: string | null;
}

export type Page = "overview" | "live" | "devices" | "subscriptions" | "customers" | "profiles" | "reports" | "system";
