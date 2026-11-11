package com.example.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShareLocation
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.DeviceAggregate
import com.example.data.model.UserRole
import com.example.data.network.ServerDeviceShareResponseDto
import com.example.data.network.ServerFleetEventDto
import com.example.data.network.ServerFleetTelemetryDto
import com.example.data.network.ServerGeofenceDto
import com.example.data.network.ServerMileageSummaryDto
import com.example.ui.FleetIntelligenceUiState
import com.example.ui.FleetPeriodPreset
import com.example.ui.FleetSubTab
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber
import com.example.ui.theme.TelemetryCyanDark
import java.time.Instant
import java.util.Locale
import kotlin.math.cos

@Composable
fun FleetIntelligenceScreen(
    devices: List<DeviceAggregate>,
    activeRole: UserRole,
    uiState: FleetIntelligenceUiState,
    isDarkTheme: Boolean,
    onSelectSubTab: (FleetSubTab) -> Unit,
    onSelectDeviceFilter: (String?) -> Unit,
    onSelectPeriod: (FleetPeriodPreset) -> Unit,
    onSelectEventTypeFilter: (String) -> Unit,
    onToggleLanguage: () -> Unit,
    onRefreshActiveSection: () -> Unit,
    onCreateGeofence: (name: String, description: String, area: String, deviceIds: List<String>) -> Unit,
    onDeleteGeofence: (Long) -> Unit,
    onCreateShareLink: (deviceId: String, expiresInHours: Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val isAr = uiState.isArabic
    val layoutDirection = if (isAr) LayoutDirection.Rtl else LayoutDirection.Ltr

    CompositionLocalProvider(LocalLayoutDirection provides layoutDirection) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(14.dp)
                .testTag("fleet_intelligence_screen"),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = if (isAr) "عمليات الأسطول" else "Fleet",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    FilterChip(
                        selected = isAr,
                        onClick = onToggleLanguage,
                        label = { Text(if (isAr) "EN" else "AR") },
                        modifier = Modifier.testTag("fleet_language_toggle_chip")
                    )
                    IconButton(
                        onClick = onRefreshActiveSection,
                        modifier = Modifier
                            .size(48.dp)
                            .testTag("fleet_section_refresh_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = if (isAr) "تحديث" else "Refresh"
                        )
                    }
                }
            }

            if (uiState.isLoading) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("fleet_loading_indicator")
                )
            }

            if (uiState.errorMessage != null) {
                Text(
                    text = uiState.errorMessage,
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 11.sp,
                    color = StatusExpiredCrimson,
                    modifier = Modifier.testTag("fleet_error_message")
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
            ) {
                FleetSubTab.entries.forEach { tab ->
                    val label = when (tab) {
                        FleetSubTab.EVENTS -> if (isAr) "الأحداث" else "Events"
                        FleetSubTab.GEOFENCES -> if (isAr) "المناطق" else "Geofences"
                        FleetSubTab.TELEMETRY -> if (isAr) "القراءات" else "Telemetry"
                        FleetSubTab.REPORTS -> if (isAr) "التقارير" else "Reports"
                        FleetSubTab.SHARE -> if (isAr) "مشاركة" else "Share"
                    }
                    val icon = when (tab) {
                        FleetSubTab.EVENTS -> Icons.Default.NotificationsActive
                        FleetSubTab.GEOFENCES -> Icons.Default.Radar
                        FleetSubTab.TELEMETRY -> Icons.Default.Speed
                        FleetSubTab.REPORTS -> Icons.Default.Assessment
                        FleetSubTab.SHARE -> Icons.Default.ShareLocation
                    }
                    FilterChip(
                        selected = uiState.activeSubTab == tab,
                        onClick = { onSelectSubTab(tab) },
                        leadingIcon = {
                            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
                        },
                        label = { Text(label) },
                        modifier = Modifier.testTag("fleet_subtab_${tab.name.lowercase()}")
                    )
                }
            }

            if (uiState.activeSubTab != FleetSubTab.GEOFENCES && uiState.activeSubTab != FleetSubTab.SHARE) {
                VehicleFilterBar(
                    devices = devices,
                    selectedDeviceId = uiState.selectedDeviceId,
                    isAr = isAr,
                    onSelectDevice = onSelectDeviceFilter
                )
            }

            if (uiState.activeSubTab == FleetSubTab.EVENTS || uiState.activeSubTab == FleetSubTab.REPORTS) {
                PeriodFilterBar(
                    selectedPeriod = uiState.selectedPeriod,
                    isAr = isAr,
                    onSelectPeriod = onSelectPeriod
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                when (uiState.activeSubTab) {
                    FleetSubTab.EVENTS -> FleetEventsSection(
                        events = uiState.events,
                        selectedEventType = uiState.selectedEventType,
                        isAr = isAr,
                        onSelectEventType = onSelectEventTypeFilter
                    )

                    FleetSubTab.GEOFENCES -> FleetGeofencesSection(
                        geofences = uiState.geofences,
                        devices = devices,
                        activeRole = activeRole,
                        isDarkTheme = isDarkTheme,
                        isAr = isAr,
                        onCreateGeofence = onCreateGeofence,
                        onDeleteGeofence = onDeleteGeofence
                    )

                    FleetSubTab.TELEMETRY -> FleetTelemetrySection(
                        telemetry = uiState.telemetry,
                        isAr = isAr
                    )

                    FleetSubTab.REPORTS -> FleetMileageReportsSection(
                        reports = uiState.mileageReports,
                        isAr = isAr
                    )

                    FleetSubTab.SHARE -> FleetTemporaryShareSection(
                        devices = devices,
                        activeShare = uiState.latestShareLink,
                        isAr = isAr,
                        onCreateShareLink = onCreateShareLink
                    )
                }
            }
        }
    }
}

@Composable
private fun VehicleFilterBar(
    devices: List<DeviceAggregate>,
    selectedDeviceId: String?,
    isAr: Boolean,
    onSelectDevice: (String?) -> Unit
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
    ) {
        FilterChip(
            selected = selectedDeviceId == null,
            onClick = { onSelectDevice(null) },
            label = { Text(if (isAr) "الكل (${devices.size})" else "All (${devices.size})") },
            modifier = Modifier.testTag("fleet_vehicle_filter_all")
        )
        devices.forEach { agg ->
            FilterChip(
                selected = selectedDeviceId == agg.device.id,
                onClick = { onSelectDevice(agg.device.id) },
                label = { Text(agg.device.vehicleName) },
                modifier = Modifier.testTag("fleet_vehicle_filter_${agg.device.id}")
            )
        }
    }
}

@Composable
private fun PeriodFilterBar(
    selectedPeriod: FleetPeriodPreset,
    isAr: Boolean,
    onSelectPeriod: (FleetPeriodPreset) -> Unit
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
    ) {
        FleetPeriodPreset.entries.forEach { preset ->
            val label = if (isAr) preset.labelAr else preset.labelEn
            FilterChip(
                selected = selectedPeriod == preset,
                onClick = { onSelectPeriod(preset) },
                label = { Text(label) },
                modifier = Modifier.testTag("fleet_period_${preset.name.lowercase()}")
            )
        }
    }
}

@Composable
private fun FleetEventsSection(
    events: List<ServerFleetEventDto>,
    selectedEventType: String,
    isAr: Boolean,
    onSelectEventType: (String) -> Unit
) {
    val eventTypes = listOf(
        "ALL" to (if (isAr) "الكل" else "All"),
        "geofenceEnter" to (if (isAr) "دخول منطقة" else "Geofence Enter"),
        "geofenceExit" to (if (isAr) "خروج منطقة" else "Geofence Exit"),
        "deviceOverspeed" to (if (isAr) "تجاوز السرعة" else "Overspeed"),
        "ignitionOn" to (if (isAr) "تشغيل المحرك" else "Ignition On"),
        "ignitionOff" to (if (isAr) "إيقاف المحرك" else "Ignition Off"),
        "deviceOnline" to (if (isAr) "متصل" else "Online"),
        "deviceOffline" to (if (isAr) "غير متصل" else "Offline")
    )

    val filtered = remember(events, selectedEventType) {
        if (selectedEventType == "ALL") events
        else events.filter { it.type.equals(selectedEventType, ignoreCase = true) }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("fleet_events_section"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
        ) {
            eventTypes.forEach { (typeKey, label) ->
                FilterChip(
                    selected = selectedEventType == typeKey,
                    onClick = { onSelectEventType(typeKey) },
                    label = { Text(label) },
                    modifier = Modifier.testTag("fleet_event_type_$typeKey")
                )
            }
        }

        if (filtered.isEmpty()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag("fleet_events_empty")
            ) {
                StatusPill(
                    text = if (isAr) "لا توجد أحداث" else "0 EVENTS",
                    color = StatusOfflineSlate
                )
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                items(filtered, key = { "${it.id}_${it.deviceId}" }) { ev ->
                    val badgeColor = when (ev.type) {
                        "geofenceEnter", "ignitionOn", "deviceOnline" -> StatusMovingEmerald
                        "geofenceExit", "ignitionOff" -> StatusWaitingAmber
                        "deviceOverspeed", "alarm" -> StatusExpiredCrimson
                        else -> MaterialTheme.colorScheme.primary
                    }
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                            .testTag("fleet_event_card_${ev.id}")
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = ev.vehicleName,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall
                                )
                                StatusPill(text = ev.type, color = badgeColor)
                            }
                            Row(
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = ev.eventTime ?: "--",
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                if (ev.geofenceId != null) {
                                    Text(
                                        text = "GF #${ev.geofenceId}",
                                        fontFamily = JetBrainsMonoFontFamily,
                                        fontSize = 11.sp,
                                        color = TelemetryCyanDark
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FleetGeofencesSection(
    geofences: List<ServerGeofenceDto>,
    devices: List<DeviceAggregate>,
    activeRole: UserRole,
    isDarkTheme: Boolean,
    isAr: Boolean,
    onCreateGeofence: (name: String, description: String, area: String, deviceIds: List<String>) -> Unit,
    onDeleteGeofence: (Long) -> Unit
) {
    var showCreateDialog by rememberSaveable { mutableStateOf(false) }
    var pendingDeleteGeofence by remember { mutableStateOf<ServerGeofenceDto?>(null) }

    var nameInput by rememberSaveable { mutableStateOf("") }
    var latInput by rememberSaveable { mutableStateOf("30.0444") }
    var lngInput by rememberSaveable { mutableStateOf("31.2357") }
    var radiusInput by rememberSaveable { mutableStateOf("500") }
    var selectedDeviceIds by remember { mutableStateOf(devices.map { it.device.id }.toSet()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("fleet_geofences_section"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        GeofenceBoundaryMapCanvas(
            geofences = geofences,
            devices = devices,
            isDarkTheme = isDarkTheme,
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp)
        )

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            StatusPill(
                text = "${geofences.size}",
                color = MaterialTheme.colorScheme.primary
            )
            if (activeRole == UserRole.ADMIN) {
                Button(
                    onClick = {
                        if (selectedDeviceIds.isEmpty() && devices.isNotEmpty()) {
                            selectedDeviceIds = setOf(devices.first().device.id)
                        }
                        showCreateDialog = true
                    },
                    modifier = Modifier
                        .heightIn(min = 48.dp)
                        .testTag("open_create_geofence_button")
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (isAr) "إضافة منطقة" else "Add Geofence")
                }
            }
        }

        if (geofences.isEmpty()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag("fleet_geofences_empty")
            ) {
                StatusPill(
                    text = if (isAr) "لا توجد مناطق" else "0 GEOFENCES",
                    color = StatusOfflineSlate
                )
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                items(geofences, key = { it.id }) { zone ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                            .testTag("geofence_card_${zone.id}")
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = zone.name,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall
                                )
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    StatusPill(
                                        text = if (zone.area.startsWith("CIRCLE", ignoreCase = true)) "CIRCLE" else "POLYGON",
                                        color = TelemetryCyanDark
                                    )
                                    if (activeRole == UserRole.ADMIN) {
                                        IconButton(
                                            onClick = { pendingDeleteGeofence = zone },
                                            modifier = Modifier
                                                .size(48.dp)
                                                .testTag("delete_geofence_button_${zone.id}")
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Delete,
                                                contentDescription = if (isAr) "حذف" else "Delete",
                                                tint = StatusExpiredCrimson
                                            )
                                        }
                                    }
                                }
                            }
                            Text(
                                text = zone.area,
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (zone.vehicleNames.isNotEmpty()) {
                                Text(
                                    text = zone.vehicleNames.joinToString(" • "),
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 10.sp,
                                    color = StatusMovingEmerald
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog && activeRole == UserRole.ADMIN) {
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text(if (isAr) "إضافة منطقة" else "Add Geofence") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = nameInput,
                        onValueChange = { nameInput = it },
                        label = { Text(if (isAr) "الاسم" else "Name") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("geofence_name_input")
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedTextField(
                            value = latInput,
                            onValueChange = { latInput = it },
                            label = { Text("Lat") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            modifier = Modifier
                                .weight(1f)
                                .testTag("geofence_lat_input")
                        )
                        OutlinedTextField(
                            value = lngInput,
                            onValueChange = { lngInput = it },
                            label = { Text("Lng") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            modifier = Modifier
                                .weight(1f)
                                .testTag("geofence_lng_input")
                        )
                    }
                    OutlinedTextField(
                        value = radiusInput,
                        onValueChange = { radiusInput = it },
                        label = { Text(if (isAr) "نصف القطر (متر)" else "Radius (m)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("geofence_radius_input")
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState())
                    ) {
                        devices.forEach { agg ->
                            val isSelected = selectedDeviceIds.contains(agg.device.id)
                            FilterChip(
                                selected = isSelected,
                                onClick = {
                                    selectedDeviceIds = if (isSelected) {
                                        selectedDeviceIds - agg.device.id
                                    } else {
                                        selectedDeviceIds + agg.device.id
                                    }
                                },
                                label = { Text(agg.device.vehicleName) },
                                modifier = Modifier.testTag("geofence_device_chip_${agg.device.id}")
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val lat = latInput.trim()
                        val lng = lngInput.trim()
                        val rad = radiusInput.trim()
                        val wkt = "CIRCLE ($lng $lat, $rad)"
                        onCreateGeofence(nameInput, "", wkt, selectedDeviceIds.toList())
                        showCreateDialog = false
                        nameInput = ""
                    },
                    modifier = Modifier.testTag("create_geofence_submit_button")
                ) {
                    Text(if (isAr) "حفظ" else "Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text(if (isAr) "إلغاء" else "Cancel")
                }
            }
        )
    }

    if (pendingDeleteGeofence != null && activeRole == UserRole.ADMIN) {
        val target = pendingDeleteGeofence!!
        AlertDialog(
            onDismissRequest = { pendingDeleteGeofence = null },
            title = { Text(if (isAr) "حذف منطقة" else "Delete Geofence") },
            text = {
                Text(
                    text = "${target.name} (#${target.id})",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 12.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        onDeleteGeofence(target.id)
                        pendingDeleteGeofence = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = StatusExpiredCrimson),
                    modifier = Modifier.testTag("confirm_delete_geofence_button")
                ) {
                    Text(if (isAr) "حذف" else "Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDeleteGeofence = null }) {
                    Text(if (isAr) "إلغاء" else "Cancel")
                }
            }
        )
    }
}

private data class ParsedCircleZone(
    val id: Long,
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusMeters: Double
)

private fun parseCircleWkt(zone: ServerGeofenceDto): ParsedCircleZone? {
    val regex = Regex(
        "^CIRCLE\\s*\\(\\s*([-+]?\\d+(?:\\.\\d+)?)\\s+([-+]?\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)\\s*\\)$",
        RegexOption.IGNORE_CASE
    )
    val match = regex.find(zone.area.trim()) ?: return null
    val first = match.groupValues[1].toDoubleOrNull() ?: return null
    val second = match.groupValues[2].toDoubleOrNull() ?: return null
    val radius = match.groupValues[3].toDoubleOrNull() ?: return null
    return ParsedCircleZone(
        id = zone.id,
        name = zone.name,
        lat = second,
        lng = first,
        radiusMeters = radius
    )
}

@Composable
private fun GeofenceBoundaryMapCanvas(
    geofences: List<ServerGeofenceDto>,
    devices: List<DeviceAggregate>,
    isDarkTheme: Boolean,
    modifier: Modifier = Modifier
) {
    val circles = remember(geofences) { geofences.mapNotNull { parseCircleWkt(it) } }
    val validDevices = remember(devices) {
        devices.filter { it.device.hasValidFix && it.device.lastLat != null && it.device.lastLng != null }
    }

    val allLats = circles.map { it.lat } + validDevices.mapNotNull { it.device.lastLat }
    val allLngs = circles.map { it.lng } + validDevices.mapNotNull { it.device.lastLng }
    val minLat = (allLats.minOrNull() ?: 30.00) - 0.03
    val maxLat = (allLats.maxOrNull() ?: 30.10) + 0.03
    val minLng = (allLngs.minOrNull() ?: 31.20) - 0.03
    val maxLng = (allLngs.maxOrNull() ?: 31.30) + 0.03

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (isDarkTheme) Color(0xFF080D16) else Color(0xFFEAF1F8))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
            .semantics { contentDescription = "Geofence boundary map" }
            .testTag("geofence_boundary_canvas")
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val gridColor = if (isDarkTheme) Color(0xFF162235) else Color(0xFFD0DCEB)
            val cols = 6
            val rows = 4
            for (c in 1 until cols) {
                val x = size.width * c / cols
                drawLine(gridColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
            }
            for (r in 1 until rows) {
                val y = size.height * r / rows
                drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            }

            val latSpan = (maxLat - minLat).coerceAtLeast(0.001)
            val lngSpan = (maxLng - minLng).coerceAtLeast(0.001)

            circles.forEach { circle ->
                val x = ((circle.lng - minLng) / lngSpan * size.width).toFloat()
                val y = ((maxLat - circle.lat) / latSpan * size.height).toFloat()
                val metersPerDegLat = 111_320.0
                val radiusDegLat = circle.radiusMeters / metersPerDegLat
                val pixelRadius = ((radiusDegLat / latSpan) * size.height).toFloat().coerceIn(14f, size.minDimension * 0.42f)

                drawCircle(
                    color = TelemetryCyanDark.copy(alpha = 0.20f),
                    radius = pixelRadius,
                    center = Offset(x, y)
                )
                drawCircle(
                    color = TelemetryCyanDark,
                    radius = pixelRadius,
                    center = Offset(x, y),
                    style = Stroke(width = 2.5f)
                )
            }

            validDevices.forEach { agg ->
                val lat = agg.device.lastLat ?: return@forEach
                val lng = agg.device.lastLng ?: return@forEach
                val x = ((lng - minLng) / lngSpan * size.width).toFloat()
                val y = ((maxLat - lat) / latSpan * size.height).toFloat()
                drawCircle(
                    color = StatusMovingEmerald,
                    radius = 6f,
                    center = Offset(x, y)
                )
            }
        }
    }
}

internal data class TelemetryMetricTile(
    val labelEn: String,
    val labelAr: String,
    val formattedValue: String
)

/**
 * Extracts only genuinely reported sensor readings from `values`.
 * Never manufactures missing readings or substitutes 0 for absent sensors.
 */
internal fun extractGenuineTelemetryMetrics(values: Map<String, Any?>): List<TelemetryMetricTile> {
    val result = mutableListOf<TelemetryMetricTile>()

    fun findValue(vararg keys: String): Any? {
        for (target in keys) {
            val entry = values.entries.firstOrNull { it.key.equals(target, ignoreCase = true) }
            if (entry?.value != null) return entry.value
        }
        return null
    }

    findValue("batteryLevel", "battery")?.let { raw ->
        result += TelemetryMetricTile("BATTERY", "البطارية", "$raw%")
    }
    findValue("power", "externalVoltage", "externalPower", "voltage")?.let { raw ->
        result += TelemetryMetricTile("VOLTAGE", "الجهد", "${raw}V")
    }
    findValue("ignition")?.let { raw ->
        val on = raw == true || raw.toString().equals("true", ignoreCase = true)
        result += TelemetryMetricTile("IGNITION", "المحرك", if (on) "ON" else "OFF")
    }
    findValue("rssi", "gsmSignal")?.let { raw ->
        result += TelemetryMetricTile("GSM", "الشبكة", raw.toString())
    }
    findValue("sat", "satellites")?.let { raw ->
        result += TelemetryMetricTile("SATELLITES", "الأقمار", raw.toString())
    }
    findValue("odometer", "totalDistance", "distance")?.let { raw ->
        val num = raw.toString().toDoubleOrNull()
        val display = if (num != null && num > 1000.0) {
            String.format(Locale.US, "%.1f km", num / 1000.0)
        } else {
            raw.toString()
        }
        result += TelemetryMetricTile("ODOMETER", "العداد", display)
    }
    findValue("engineHours")?.let { raw ->
        result += TelemetryMetricTile("ENGINE HOURS", "ساعات المحرك", "${raw}h")
    }
    findValue("fuelLevel", "fuel", "fuelPercentage")?.let { raw ->
        result += TelemetryMetricTile("FUEL", "الوقود", raw.toString())
    }
    findValue("temperature1", "temperature", "temperature2")?.let { raw ->
        result += TelemetryMetricTile("TEMP", "الحرارة", "${raw}°C")
    }

    return result
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FleetTelemetrySection(
    telemetry: List<ServerFleetTelemetryDto>,
    isAr: Boolean
) {
    if (telemetry.isEmpty()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .testTag("fleet_telemetry_empty")
        ) {
            StatusPill(
                text = if (isAr) "لا توجد قراءات" else "0 TELEMETRY",
                color = StatusOfflineSlate
            )
        }
        return
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxSize()
            .testTag("fleet_telemetry_section")
    ) {
        items(telemetry, key = { it.deviceId }) { item ->
            val metrics = remember(item.values) { extractGenuineTelemetryMetrics(item.values) }
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                    .testTag("telemetry_card_${item.deviceId}")
            ) {
                Column(
                    modifier = Modifier.padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = item.vehicleName,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleSmall
                        )
                        StatusPill(
                            text = if (item.reportedAtMs != null) {
                                Instant.ofEpochMilli(item.reportedAtMs).toString().take(19).replace('T', ' ')
                            } else {
                                if (isAr) "غير متوفر" else "NO TIMESTAMP"
                            },
                            color = if (metrics.isNotEmpty()) StatusMovingEmerald else StatusOfflineSlate
                        )
                    }

                    if (metrics.isEmpty()) {
                        StatusPill(
                            text = if (isAr) "لا توجد قراءات حساسات" else "NO SENSOR DATA",
                            color = StatusOfflineSlate
                        )
                    } else {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            metrics.forEach { tile ->
                                Column(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                                        .padding(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = if (isAr) tile.labelAr else tile.labelEn,
                                        fontFamily = JetBrainsMonoFontFamily,
                                        fontSize = 9.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Text(
                                        text = tile.formattedValue,
                                        fontFamily = JetBrainsMonoFontFamily,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FleetMileageReportsSection(
    reports: List<ServerMileageSummaryDto>,
    isAr: Boolean
) {
    if (reports.isEmpty()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .testTag("fleet_reports_empty")
        ) {
            StatusPill(
                text = if (isAr) "لا توجد تقارير" else "0 REPORTS",
                color = StatusOfflineSlate
            )
        }
        return
    }

    val totalDistanceKm = reports.mapNotNull { it.distanceKm }.sum()
    val maxSpeedKmh = reports.mapNotNull { it.maxSpeedKmh }.maxOrNull()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("fleet_reports_section"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            ReportSummaryTile(
                label = if (isAr) "المسافة" else "DISTANCE",
                value = String.format(Locale.US, "%.2f km", totalDistanceKm),
                modifier = Modifier.weight(1f)
            )
            ReportSummaryTile(
                label = if (isAr) "أقصى سرعة" else "MAX SPEED",
                value = if (maxSpeedKmh != null) String.format(Locale.US, "%.1f km/h", maxSpeedKmh) else "--",
                modifier = Modifier.weight(1f)
            )
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            items(reports, key = { it.deviceId }) { row ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                        .testTag("mileage_report_card_${row.deviceId}")
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = row.vehicleName,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleSmall
                            )
                            StatusPill(
                                text = if (row.distanceKm != null) {
                                    String.format(Locale.US, "%.2f km", row.distanceKm)
                                } else {
                                    "--"
                                },
                                color = StatusMovingEmerald
                            )
                        }

                        Row(
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = "${if (isAr) "متوسط" else "AVG"}: ${
                                    if (row.averageSpeedKmh != null) String.format(Locale.US, "%.1f km/h", row.averageSpeedKmh) else "--"
                                }",
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 11.sp
                            )
                            Text(
                                text = "${if (isAr) "أقصى" else "MAX"}: ${
                                    if (row.maxSpeedKmh != null) String.format(Locale.US, "%.1f km/h", row.maxSpeedKmh) else "--"
                                }",
                                fontFamily = JetBrainsMonoFontFamily,
                                fontSize = 11.sp
                            )
                            if (row.engineHours != null) {
                                Text(
                                    text = "${if (isAr) "ساعات" else "HRS"}: ${String.format(Locale.US, "%.1fh", row.engineHours)}",
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 11.sp
                                )
                            }
                            if (row.spentFuelLiters != null) {
                                Text(
                                    text = "${if (isAr) "وقود" else "FUEL"}: ${String.format(Locale.US, "%.1fL", row.spentFuelLiters)}",
                                    fontFamily = JetBrainsMonoFontFamily,
                                    fontSize = 11.sp,
                                    color = TelemetryCyanDark
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportSummaryTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(10.dp),
        modifier = modifier.border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                text = label,
                fontFamily = JetBrainsMonoFontFamily,
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = value,
                fontFamily = JetBrainsMonoFontFamily,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun FleetTemporaryShareSection(
    devices: List<DeviceAggregate>,
    activeShare: ServerDeviceShareResponseDto?,
    isAr: Boolean,
    onCreateShareLink: (deviceId: String, expiresInHours: Int) -> Unit
) {
    val clipboard = LocalClipboardManager.current
    var selectedDeviceId by rememberSaveable(devices) {
        mutableStateOf(devices.firstOrNull()?.device?.id.orEmpty())
    }
    var selectedHours by rememberSaveable { mutableIntStateOf(24) }
    val durationOptions = listOf(1, 6, 24, 72, 168)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("fleet_share_section"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    devices.forEach { agg ->
                        FilterChip(
                            selected = selectedDeviceId == agg.device.id,
                            onClick = { selectedDeviceId = agg.device.id },
                            label = { Text(agg.device.vehicleName) },
                            modifier = Modifier.testTag("share_vehicle_chip_${agg.device.id}")
                        )
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    durationOptions.forEach { hrs ->
                        FilterChip(
                            selected = selectedHours == hrs,
                            onClick = { selectedHours = hrs },
                            label = { Text("${hrs}H") },
                            modifier = Modifier.testTag("share_duration_chip_$hrs")
                        )
                    }
                }

                Button(
                    onClick = {
                        if (selectedDeviceId.isNotBlank()) {
                            onCreateShareLink(selectedDeviceId, selectedHours)
                        }
                    },
                    enabled = selectedDeviceId.isNotBlank(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .testTag("create_share_link_button")
                ) {
                    Icon(Icons.Default.ShareLocation, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (isAr) "إنشاء رابط مشاركة" else "Create Share Link")
                }
            }
        }

        if (activeShare != null) {
            val isExpired = remember(activeShare.expiresAt) {
                runCatching {
                    Instant.parse(activeShare.expiresAt).toEpochMilli() <= System.currentTimeMillis()
                }.getOrDefault(false)
            }

            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
                    .testTag("active_share_link_card")
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = activeShare.vehicleName,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleSmall
                        )
                        StatusPill(
                            text = if (isExpired) "EXPIRED" else "ACTIVE",
                            color = if (isExpired) StatusExpiredCrimson else StatusMovingEmerald
                        )
                    }

                    Text(
                        text = activeShare.shareUrl,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp,
                        color = TelemetryCyanDark,
                        modifier = Modifier.testTag("share_link_url_text")
                    )

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = activeShare.expiresAt,
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        OutlinedButton(
                            onClick = {
                                clipboard.setText(AnnotatedString(activeShare.shareUrl))
                            },
                            modifier = Modifier
                                .heightIn(min = 48.dp)
                                .testTag("copy_share_link_button")
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(if (isAr) "نسخ" else "Copy")
                        }
                    }
                }
            }
        }
    }
}
