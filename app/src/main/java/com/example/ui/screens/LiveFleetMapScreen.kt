package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.GpsOff
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.PlanDuration
import com.example.data.model.UserRole
import com.example.ui.FleetFilter
import com.example.ui.RoutePlaybackState
import com.example.ui.components.VeloTrackMapLibreCanvas
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber
import java.util.Locale

@Composable
fun LiveFleetMapScreen(
    devices: List<DeviceAggregate>,
    selectedDeviceId: String?,
    activeFilter: FleetFilter,
    activeRole: UserRole,
    routePlayback: RoutePlaybackState?,
    isDarkTheme: Boolean,
    onSelectFilter: (FleetFilter) -> Unit,
    onSelectDevice: (String) -> Unit,
    onOpenRouteHistory: (String) -> Unit,
    onScrubRoute: (Int) -> Unit,
    onCloseRouteHistory: () -> Unit,
    onSimulateTraccarPacket: (String, Boolean) -> Unit,
    onQuickRenew: (String, PlanDuration) -> Unit,
    onTestFiveSecExpiry: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedAggregate = devices.find { it.device.id == selectedDeviceId } ?: devices.firstOrNull()
    val activeWaypoints = if (routePlayback?.deviceId == selectedAggregate?.device?.id) {
        routePlayback?.waypoints ?: emptyList()
    } else {
        emptyList()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .testTag("live_fleet_map_screen")
    ) {
        // Top Map Canvas Area (52% height)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.52f)
        ) {
            VeloTrackMapLibreCanvas(
                devices = devices,
                selectedDeviceId = selectedAggregate?.device?.id,
                routeWaypoints = activeWaypoints,
                activeWaypointIndex = routePlayback?.currentIndex ?: 0,
                isDarkTheme = isDarkTheme,
                onSelectDevice = onSelectDevice
            )

            // Floating Minimal Filter Bar
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FleetFilter.entries.forEach { filter ->
                    val selected = filter == activeFilter
                    FilterChip(
                        selected = selected,
                        onClick = { onSelectFilter(filter) },
                        label = {
                            Text(
                                text = filter.shortLabel,
                                style = MaterialTheme.typography.labelLarge
                            )
                        },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                            selectedContainerColor = MaterialTheme.colorScheme.primary,
                            selectedLabelColor = MaterialTheme.colorScheme.onPrimary
                        ),
                        modifier = Modifier.testTag("filter_chip_${filter.name.lowercase()}")
                    )
                }
            }
        }

        // Bottom Telemetry HUD & Compact Fleet Sheet (48% height)
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.48f)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                if (selectedAggregate != null) {
                    SelectedVehicleHudCard(
                        aggregate = selectedAggregate,
                        activeRole = activeRole,
                        routePlayback = routePlayback,
                        onOpenRouteHistory = { onOpenRouteHistory(selectedAggregate.device.id) },
                        onScrubRoute = onScrubRoute,
                        onCloseRouteHistory = onCloseRouteHistory,
                        onSimulateTraccarPacket = { hasFix ->
                            onSimulateTraccarPacket(selectedAggregate.device.id, hasFix)
                        },
                        onQuickRenew = { plan ->
                            onQuickRenew(selectedAggregate.device.id, plan)
                        },
                        onTestFiveSecExpiry = {
                            onTestFiveSecExpiry(selectedAggregate.device.id)
                        }
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                // Compact Fleet List
                Text(
                    text = "FLEET (${devices.size})",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp)
                )

                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .testTag("fleet_vehicle_list")
                ) {
                    items(devices, key = { it.device.id }) { agg ->
                        CompactVehicleRow(
                            aggregate = agg,
                            isSelected = agg.device.id == selectedAggregate?.device?.id,
                            onClick = { onSelectDevice(agg.device.id) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectedVehicleHudCard(
    aggregate: DeviceAggregate,
    activeRole: UserRole,
    routePlayback: RoutePlaybackState?,
    onOpenRouteHistory: () -> Unit,
    onScrubRoute: (Int) -> Unit,
    onCloseRouteHistory: () -> Unit,
    onSimulateTraccarPacket: (Boolean) -> Unit,
    onQuickRenew: (PlanDuration) -> Unit,
    onTestFiveSecExpiry: () -> Unit
) {
    val dev = aggregate.device
    val now = System.currentTimeMillis()
    val isActivated = dev.activationStatus == ActivationStatus.ACTIVATED.name
    val isAccessible = aggregate.isSubscriptionAccessible(now)
    val isExpired = isActivated && !isAccessible

    val statusColor = when {
        isExpired -> StatusExpiredCrimson
        !isActivated -> StatusWaitingAmber
        dev.ignitionOn -> StatusMovingEmerald
        else -> StatusOfflineSlate
    }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)
        ),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, statusColor.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
            .testTag("selected_vehicle_hud_card")
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(statusColor.copy(alpha = 0.18f))
                    ) {
                        Icon(
                            imageVector = if (isExpired) Icons.Default.Lock else Icons.Default.DirectionsCar,
                            contentDescription = null,
                            tint = statusColor,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    Column {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = dev.vehicleName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            StatusPill(
                                text = dev.plateNumber,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Text(
                            text = "IMEI ${dev.imei} • SIM ${dev.simLocalNumber}",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                StatusPill(
                    text = aggregate.remainingDaysText(now),
                    color = statusColor
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Case 1: Subscription Expired -> Block telemetry & show renewal action
            if (isExpired) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(StatusExpiredCrimson.copy(alpha = 0.15f))
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                        .testTag("expired_access_blocked_banner")
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = "Blocked",
                            tint = StatusExpiredCrimson,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "EXPIRED • Live WS & History Blocked",
                            style = MaterialTheme.typography.labelMedium,
                            color = StatusExpiredCrimson,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    if (activeRole == UserRole.ADMIN) {
                        Button(
                            onClick = { onQuickRenew(PlanDuration.MONTH_12) },
                            colors = ButtonDefaults.buttonColors(containerColor = StatusMovingEmerald),
                            modifier = Modifier
                                .heightIn(min = 36.dp)
                                .testTag("hud_quick_renew_12m_button")
                        ) {
                            Text("Renew 12M", fontSize = 11.sp)
                        }
                    }
                }
            }
            // Case 2: Device Waiting for 1st Traccar Connection -> Show 4-Stage Status & Verification Trigger
            else if (!isActivated) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(StatusWaitingAmber.copy(alpha = 0.14f))
                        .padding(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "STATE: ${dev.activationStatus} • Awaiting :5023 IMEI Packet",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            color = StatusWaitingAmber,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    if (activeRole == UserRole.ADMIN) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            OutlinedButton(
                                onClick = { onSimulateTraccarPacket(false) },
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 36.dp)
                                    .testTag("hud_sim_no_gps_fix_button")
                            ) {
                                Icon(Icons.Default.GpsOff, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("1st Packet (No Fix)", fontSize = 10.sp)
                            }
                            Button(
                                onClick = { onSimulateTraccarPacket(true) },
                                colors = ButtonDefaults.buttonColors(containerColor = StatusMovingEmerald),
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 36.dp)
                                    .testTag("hud_sim_gps_fix_button")
                            ) {
                                Icon(Icons.Default.GpsFixed, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("1st Packet (GPS Fix)", fontSize = 10.sp)
                            }
                        }
                    }
                }
            }
            // Case 3: Active & Accessible -> Show Telemetry Readout + Route History + 5s Expiry Test
            else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    TelemetryStatItem(
                        label = "SPEED",
                        value = "${dev.lastSpeedKmh.toInt()} km/h",
                        color = if (dev.ignitionOn) StatusMovingEmerald else MaterialTheme.colorScheme.onSurface
                    )
                    TelemetryStatItem(
                        label = "STATE",
                        value = if (dev.connectionState.contains("NO_FIX")) "NO FIX (ONLINE)" else if (dev.ignitionOn) "ACC ON" else "PARKED",
                        color = MaterialTheme.colorScheme.primary
                    )
                    TelemetryStatItem(
                        label = "COORDS",
                        value = String.format(Locale.US, "%.4f, %.4f", dev.lastLat, dev.lastLng),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                if (routePlayback != null && routePlayback.deviceId == dev.id && routePlayback.waypoints.isNotEmpty()) {
                    val wp = routePlayback.waypoints[routePlayback.currentIndex]
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = "Scrub Route",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "${wp.addressLabel} (${wp.speedKmh.toInt()} km/h)",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            modifier = Modifier
                                .padding(start = 4.dp)
                                .weight(1f)
                        )
                        IconButton(
                            onClick = onCloseRouteHistory,
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Close History", modifier = Modifier.size(14.dp))
                        }
                    }
                    Slider(
                        value = routePlayback.currentIndex.toFloat(),
                        onValueChange = { onScrubRoute(it.toInt()) },
                        valueRange = 0f..(routePlayback.waypoints.lastIndex.coerceAtLeast(1)).toFloat(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(24.dp)
                            .testTag("route_history_slider")
                    )
                } else {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        OutlinedButton(
                            onClick = onOpenRouteHistory,
                            modifier = Modifier
                                .weight(1f)
                                .heightIn(min = 38.dp)
                                .testTag("hud_route_history_button")
                        ) {
                            Icon(Icons.Default.History, contentDescription = null, modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Route History", fontSize = 11.sp)
                        }
                        if (activeRole == UserRole.ADMIN) {
                            OutlinedButton(
                                onClick = onTestFiveSecExpiry,
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 38.dp)
                                    .testTag("hud_test_5s_expiry_button")
                            ) {
                                Icon(Icons.Default.Timer, contentDescription = null, tint = StatusWaitingAmber, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Test 5s Expiry", fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CompactVehicleRow(
    aggregate: DeviceAggregate,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val dev = aggregate.device
    val now = System.currentTimeMillis()
    val isActivated = dev.activationStatus == ActivationStatus.ACTIVATED.name
    val isAccessible = aggregate.isSubscriptionAccessible(now)
    val isExpired = isActivated && !isAccessible

    val dotColor = when {
        isExpired -> StatusExpiredCrimson
        !isActivated -> StatusWaitingAmber
        dev.ignitionOn -> StatusMovingEmerald
        else -> StatusOfflineSlate
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(
                if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
            )
            .border(
                width = 1.dp,
                color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = RoundedCornerShape(10.dp)
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .testTag("fleet_row_${dev.id}")
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(1f)
        ) {
            Icon(
                imageVector = when {
                    isExpired -> Icons.Default.Lock
                    !isActivated -> Icons.Default.Schedule
                    else -> Icons.Default.CheckCircle
                },
                contentDescription = null,
                tint = dotColor,
                modifier = Modifier.size(16.dp)
            )
            Column {
                Text(
                    text = "${dev.vehicleName} • ${dev.plateNumber}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${aggregate.customer.fullName.substringBefore("•").trim()} • IMEI ${dev.imei.takeLast(6)}",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Column(horizontalAlignment = Alignment.End) {
            StatusPill(
                text = when {
                    isExpired -> "EXPIRED"
                    !isActivated -> dev.activationStatus
                    dev.ignitionOn -> "${dev.lastSpeedKmh.toInt()} km/h"
                    else -> "PARKED"
                },
                color = dotColor
            )
        }
    }
}

@Composable
private fun TelemetryStatItem(
    label: String,
    value: String,
    color: Color
) {
    Column {
        Text(
            text = label,
            fontFamily = JetBrainsMonoFontFamily,
            fontSize = 9.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            fontFamily = JetBrainsMonoFontFamily,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = color
        )
    }
}

@Composable
fun StatusPill(
    text: String,
    color: Color,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.16f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            fontFamily = JetBrainsMonoFontFamily,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            color = color
        )
    }
}
