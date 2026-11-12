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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
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
    userLocation: Pair<Double, Double>? = null,
    hasLocationPermission: Boolean = false,
    onRequestLocationPermission: () -> Unit = {},
    activeFilter: FleetFilter,
    activeRole: UserRole,
    routePlayback: RoutePlaybackState?,
    isDarkTheme: Boolean,
    onSelectFilter: (FleetFilter) -> Unit,
    onSelectDevice: (String) -> Unit,
    onOpenRouteHistory: (String) -> Unit,
    onScrubRoute: (Int) -> Unit,
    onCloseRouteHistory: () -> Unit,
    onQuickRenew: (String, PlanDuration) -> Unit,
    onNavigateToActivate: () -> Unit,
    onRefresh: () -> Unit,
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
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.55f)
        ) {
            VeloTrackMapLibreCanvas(
                devices = devices,
                selectedDeviceId = selectedAggregate?.device?.id,
                userLocation = userLocation,
                routeWaypoints = activeWaypoints,
                activeWaypointIndex = routePlayback?.currentIndex ?: 0,
                isDarkTheme = isDarkTheme,
                onSelectDevice = onSelectDevice
            )

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

            if (!hasLocationPermission) {
                Card(
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f)
                    ),
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp)
                        .testTag("location_permission_card")
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.MyLocation,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "Enable location for map",
                            style = MaterialTheme.typography.labelMedium
                        )
                        Button(
                            onClick = onRequestLocationPermission,
                            modifier = Modifier
                                .heightIn(min = 32.dp)
                                .testTag("grant_location_permission_button")
                        ) {
                            Text("Allow", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                IconButton(
                    onClick = onRequestLocationPermission,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(12.dp)
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f), CircleShape)
                        .border(1.dp, MaterialTheme.colorScheme.outline, CircleShape)
                        .testTag("my_location_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.MyLocation,
                        contentDescription = "My Location",
                        tint = if (userLocation != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.45f)
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
                        onQuickRenew = { plan ->
                            onQuickRenew(selectedAggregate.device.id, plan)
                        }
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 4.dp)
                ) {
                    Text(
                        text = "FLEET (${devices.size})",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    IconButton(
                        onClick = onRefresh,
                        modifier = Modifier
                            .size(28.dp)
                            .testTag("fleet_refresh_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }

                if (devices.isEmpty()) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .testTag("empty_fleet_container")
                    ) {
                        if (activeRole == UserRole.ADMIN) {
                            OutlinedButton(
                                onClick = onNavigateToActivate,
                                modifier = Modifier
                                    .heightIn(min = 48.dp)
                                    .testTag("empty_state_activate_button")
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Activate")
                            }
                        } else {
                            OutlinedButton(
                                onClick = onRefresh,
                                modifier = Modifier
                                    .heightIn(min = 48.dp)
                                    .testTag("empty_state_refresh_button")
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Refresh")
                            }
                        }
                    }
                } else {
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
}

@Composable
private fun SelectedVehicleHudCard(
    aggregate: DeviceAggregate,
    activeRole: UserRole,
    routePlayback: RoutePlaybackState?,
    onOpenRouteHistory: () -> Unit,
    onScrubRoute: (Int) -> Unit,
    onCloseRouteHistory: () -> Unit,
    onQuickRenew: (PlanDuration) -> Unit
) {
    val dev = aggregate.device
    val now = System.currentTimeMillis()
    val isActivated = dev.activationStatus == ActivationStatus.ACTIVATED.name
    val isAccessible = aggregate.isSubscriptionAccessible(now)
    val isExpired = isActivated && !isAccessible

    val statusColor = when {
        isExpired -> StatusExpiredCrimson
        !isActivated -> StatusWaitingAmber
        dev.ignitionOn == true -> StatusMovingEmerald
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
                            text = "${dev.imei} • ${dev.simLocalNumber}",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                StatusPill(
                    text = aggregate.compactSubscriptionBadge(now),
                    color = statusColor
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

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
                            contentDescription = "EXPIRED",
                            tint = StatusExpiredCrimson,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = "EXPIRED",
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
            } else if (!isActivated) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(StatusWaitingAmber.copy(alpha = 0.14f))
                        .padding(8.dp)
                ) {
                    Text(
                        text = dev.activationStatus,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp,
                        color = StatusWaitingAmber,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = dev.connectionState,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    TelemetryStatItem(
                        label = "SPEED",
                        value = dev.lastSpeedKmh?.let { "${it.toInt()} km/h" } ?: "--",
                        color = if (dev.ignitionOn == true) StatusMovingEmerald else MaterialTheme.colorScheme.onSurface
                    )
                    TelemetryStatItem(
                        label = "STATE",
                        value = when {
                            !dev.hasValidFix -> "NO FIX"
                            dev.ignitionOn == true -> "ONLINE"
                            else -> "OFFLINE"
                        },
                        color = MaterialTheme.colorScheme.primary
                    )
                    TelemetryStatItem(
                        label = "COORDS",
                        value = if (dev.hasValidFix && dev.lastLat != null && dev.lastLng != null) {
                            String.format(Locale.US, "%.4f, %.4f", dev.lastLat, dev.lastLng)
                        } else {
                            "--"
                        },
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
                            contentDescription = "Route",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = String.format(Locale.US, "%.4f, %.4f • %d km/h", wp.latitude, wp.longitude, wp.speedKmh.toInt()),
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
                            Icon(Icons.Default.Close, contentDescription = "Close", modifier = Modifier.size(14.dp))
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
                    OutlinedButton(
                        onClick = onOpenRouteHistory,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 38.dp)
                            .testTag("hud_route_history_button")
                    ) {
                        Icon(Icons.Default.History, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("History", fontSize = 11.sp)
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
        dev.ignitionOn == true -> StatusMovingEmerald
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
                    text = dev.imei,
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        StatusPill(
            text = when {
                isExpired -> "EXPIRED"
                !isActivated -> dev.activationStatus
                dev.lastSpeedKmh != null && dev.ignitionOn == true -> "${dev.lastSpeedKmh.toInt()} km/h"
                dev.hasValidFix -> "ONLINE"
                else -> "NO FIX"
            },
            color = dotColor
        )
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
