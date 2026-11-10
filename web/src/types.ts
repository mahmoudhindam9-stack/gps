export type Role = "ADMIN" | "CUSTOMER";

export type VehicleType =
  | "CAR"
  | "MOTORCYCLE"
  | "TRUCK"
  | "BUS"
  | "VAN"
  | "EQUIPMENT"
  | "OTHER";

export type VehicleIcon =
  | "car"
  | "suv"
  | "motorcycle"
  | "truck"
  | "bus"
  | "van"
  | "pickup"
  | "tractor";

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  fullName: string;
  role: Role | string;
  mustChangePassword: boolean;
  isActive: boolean;
  deletedAtMs?: number | null;
  vehicleCount?: number;
  activeSubscriptionCount?: number;
  pendingSubscriptionCount?: number;
  expiredSubscriptionCount?: number;
  suspendedSubscriptionCount?: number;
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
  serialNumber?: string | null;
  traccarDeviceId: number;
  profileId: string;
  currentCustomerId: string;
  vehicleName: string;
  vehicleType?: VehicleType | string;
  vehicleIcon?: VehicleIcon | string;
  plateNumber: string;
  simNumber?: string;
  simLocalNumber?: string;
  simE164Number?: string;
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
  supportedCommands?: string[];
  isVerified: boolean;
  createdAtMs: number;
}

export interface SmsLog {
  id: string;
  commandKey: string;
  commandText: string;
  status: string;
  idempotencyKey?: string | null;
  deviceReply?: string | null;
  failureReason?: string | null;
  sentAtMs: number;
}

export interface DeviceCommandType {
  type: string;
  labelAr: string;
  labelEn: string;
  sensitive: boolean;
  requiresConfirmation: boolean;
  customerPermitted: boolean;
  parameters: string[];
}

export interface DeviceCommandLog {
  id: string;
  deviceId: string;
  issuedByUserId: string;
  issuedByRole: string;
  commandType: string;
  parameters: Record<string, unknown>;
  status: string;
  traccarCommandId: number | null;
  responseText: string | null;
  failureReason: string | null;
  createdAtMs: number;
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
  commandHistory?: DeviceCommandLog[];
  supportedCommands?: DeviceCommandType[];
}

export interface CustomerDetails {
  customer: User;
  summary: {
    totalVehicles: number;
    totalSubscriptions: number;
    activeSubscriptionsCount: number;
    pendingSubscriptionsCount: number;
    expiredSubscriptionsCount: number;
    suspendedSubscriptionsCount: number;
  };
  vehicles: DeviceBundle[];
}

export interface Health {
  status: string;
  version?: string;
  repository?: string;
  supabaseConnected: boolean;
  traccarConnected: boolean;
  traccarWsConnected: boolean;
  traccarLastSyncAtMs?: number | null;
  smsGatewayConfigured: boolean;
  databaseError?: string | null;
}

export interface GitHubReleaseInfo {
  currentVersion: string;
  repository: string;
  latestVersion: string;
  tagName: string;
  releaseName: string;
  publishedAt: string | null;
  htmlUrl: string;
  apkDownloadUrl: string | null;
  webBundleDownloadUrl: string | null;
  releaseNotes: string;
  updateAvailable: boolean;
  autoUpdateEnabled: boolean;
  checkedAtMs: number;
  status: "UP_TO_DATE" | "UPDATE_AVAILABLE" | "OFFLINE";
}

export type Page =
  | "overview"
  | "live"
  | "devices"
  | "subscriptions"
  | "customers"
  | "customer_details"
  | "profiles"
  | "reports"
  | "system";

