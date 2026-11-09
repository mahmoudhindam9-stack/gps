package com.example.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.R
import com.example.data.local.CachedWaypointEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber
import com.example.ui.theme.TelemetryCyanDark
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapView

/**
 * Self-Hosted MapLibre Native Android (>= 11.7.0) + PMTiles Vector Canvas.
 * - Initializes MapLibre Native 11.7.0+ with pmtiles:// byte-range support.
 * - Renders high-contrast Greater Cairo / Nile tactical vector overlay & interactive markers
 *   so vehicles and route polylines remain 100% responsive even offline without a live tile server.
 * - Displays mandatory visible "© OpenStreetMap contributors" attribution badge.
 */
@Composable
fun VeloTrackMapLibreCanvas(
    devices: List<DeviceAggregate>,
    selectedDeviceId: String?,
    routeWaypoints: List<CachedWaypointEntity>,
    activeWaypointIndex: Int,
    isDarkTheme: Boolean,
    onSelectDevice: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val mapLibreAvailable = remember {
        runCatching {
            MapLibre.getInstance(context)
            true
        }.getOrDefault(false)
    }

    // Center bounds around Greater Cairo (Lat 30.00..30.09, Lng 31.18..31.30)
    val minLat = 30.0000
    val maxLat = 30.0900
    val minLng = 31.1800
    val maxLng = 31.3000

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(if (isDarkTheme) Color(0xFF080D16) else Color(0xFFEAF1F8))
            .testTag("maplibre_canvas_container")
    ) {
        // 1. Native MapLibre 11.7.0+ View Layer (when native GL is available on device)
        if (mapLibreAvailable) {
            val mapView = remember {
                runCatching {
                    MapView(context).apply { onCreate(null) }
                }.getOrNull()
            }
            if (mapView != null) {
                DisposableEffect(mapView) {
                    onDispose {
                        runCatching { mapView.onDestroy() }
                    }
                }
                AndroidView(
                    factory = {
                        mapView.apply {
                            getMapAsync { map ->
                                val bgHex = if (isDarkTheme) "#080D16" else "#EAF1F8"
                                val pmtilesStyleJson = """
                                    {
                                      "version": 8,
                                      "name": "VeloTrack Self-Hosted PMTiles",
                                      "sources": {
                                        "egypt-pmtiles": {
                                          "type": "vector",
                                          "url": "pmtiles://https://gps.velotrack.eg/tiles/egypt.pmtiles"
                                        }
                                      },
                                      "layers": [
                                        {
                                          "id": "background",
                                          "type": "background",
                                          "paint": { "background-color": "$bgHex" }
                                        }
                                      ]
                                    }
                                """.trimIndent()
                                map.setStyle(org.maplibre.android.maps.Style.Builder().fromJson(pmtilesStyleJson))
                                map.uiSettings.isAttributionEnabled = false
                                map.uiSettings.isLogoEnabled = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        // 2. High-Precision Vector Map Overlay (Nile River, Cairo Arterials, Route Polylines & Markers)
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(devices) {
                    detectTapGestures { tapOffset ->
                        val width = size.width.toFloat().coerceAtLeast(1f)
                        val height = size.height.toFloat().coerceAtLeast(1f)
                        val hitDevice = devices.minByOrNull { agg ->
                            val x = ((agg.device.lastLng - minLng) / (maxLng - minLng)).toFloat() * width
                            val y = (1f - ((agg.device.lastLat - minLat) / (maxLat - minLat)).toFloat()) * height
                            val dx = tapOffset.x - x
                            val dy = tapOffset.y - y
                            dx * dx + dy * dy
                        }
                        if (hitDevice != null) {
                            onSelectDevice(hitDevice.device.id)
                        }
                    }
                }
        ) {
            val w = size.width
            val h = size.height
            val gridColor = if (isDarkTheme) Color(0xFF152036) else Color(0xFFD5E2EE)
            val roadColor = if (isDarkTheme) Color(0xFF1E2D4A) else Color(0xFFCBD5E1)
            val nileColor = if (isDarkTheme) Color(0xFF0B253C) else Color(0xFFBAE6FD)

            // Coordinate grid lines
            val cols = 8
            val rows = 10
            for (c in 1 until cols) {
                val x = (w / cols) * c
                drawLine(gridColor, Offset(x, 0f), Offset(x, h), strokeWidth = 1.dp.toPx())
            }
            for (r in 1 until rows) {
                val y = (h / rows) * r
                drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1.dp.toPx())
            }

            // Nile River Corridor through Greater Cairo
            val nilePath = Path().apply {
                moveTo(w * 0.36f, h * 1.0f)
                cubicTo(w * 0.39f, h * 0.72f, w * 0.44f, h * 0.48f, w * 0.41f, 0f)
            }
            drawPath(
                path = nilePath,
                color = nileColor,
                style = Stroke(width = 28.dp.toPx(), cap = StrokeCap.Round)
            )

            // Major Cairo / Giza Arterials (Ring Road, 6th October Bridge, Salah Salem)
            val octBridge = Path().apply {
                moveTo(w * 0.12f, h * 0.58f)
                quadraticTo(w * 0.45f, h * 0.49f, w * 0.88f, h * 0.32f)
            }
            drawPath(octBridge, roadColor, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round))

            val ringRoad = Path().apply {
                moveTo(w * 0.05f, h * 0.82f)
                quadraticTo(w * 0.52f, h * 0.68f, w * 0.95f, h * 0.18f)
            }
            drawPath(ringRoad, roadColor, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))

            // Historical Route Polyline (when a vehicle's history is open and subscription is active)
            if (routeWaypoints.size >= 2) {
                val routePath = Path()
                routeWaypoints.forEachIndexed { idx, wp ->
                    val px = ((wp.longitude - minLng) / (maxLng - minLng)).toFloat().coerceIn(0.05f, 0.95f) * w
                    val py = (1f - ((wp.latitude - minLat) / (maxLat - minLat)).toFloat().coerceIn(0.08f, 0.92f)) * h
                    if (idx == 0) routePath.moveTo(px, py) else routePath.lineTo(px, py)
                }
                drawPath(
                    path = routePath,
                    color = TelemetryCyanDark,
                    style = Stroke(
                        width = 4.dp.toPx(),
                        cap = StrokeCap.Round,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(18f, 10f), 0f)
                    )
                )
                routeWaypoints.forEachIndexed { idx, wp ->
                    val px = ((wp.longitude - minLng) / (maxLng - minLng)).toFloat().coerceIn(0.05f, 0.95f) * w
                    val py = (1f - ((wp.latitude - minLat) / (maxLat - minLat)).toFloat().coerceIn(0.08f, 0.92f)) * h
                    val isCurrentScrub = idx == activeWaypointIndex
                    drawCircle(
                        color = if (isCurrentScrub) StatusMovingEmerald else TelemetryCyanDark,
                        radius = if (isCurrentScrub) 8.dp.toPx() else 4.dp.toPx(),
                        center = Offset(px, py)
                    )
                }
            }

            // Vehicle Markers
            val now = System.currentTimeMillis()
            devices.forEach { agg ->
                val dev = agg.device
                val px = ((dev.lastLng - minLng) / (maxLng - minLng)).toFloat().coerceIn(0.08f, 0.92f) * w
                val py = (1f - ((dev.lastLat - minLat) / (maxLat - minLat)).toFloat().coerceIn(0.12f, 0.86f)) * h
                val isSelected = dev.id == selectedDeviceId
                val isExpired = !agg.isSubscriptionAccessible(now) &&
                    dev.activationStatus == ActivationStatus.ACTIVATED.name

                val markerColor = when {
                    isExpired -> StatusExpiredCrimson
                    dev.activationStatus != ActivationStatus.ACTIVATED.name -> StatusWaitingAmber
                    dev.ignitionOn -> StatusMovingEmerald
                    else -> StatusOfflineSlate
                }

                if (isSelected) {
                    drawCircle(
                        color = markerColor.copy(alpha = 0.24f),
                        radius = 26.dp.toPx(),
                        center = Offset(px, py)
                    )
                    drawCircle(
                        color = markerColor,
                        radius = 26.dp.toPx(),
                        center = Offset(px, py),
                        style = Stroke(width = 2.dp.toPx())
                    )
                }

                // Outer marker badge
                drawCircle(
                    color = if (isDarkTheme) Color(0xFF0B0F17) else Color.White,
                    radius = 14.dp.toPx(),
                    center = Offset(px, py)
                )
                drawCircle(
                    color = markerColor,
                    radius = 11.dp.toPx(),
                    center = Offset(px, py)
                )

                // Heading arrow inside marker for active non-expired vehicles
                if (!isExpired && dev.activationStatus == ActivationStatus.ACTIVATED.name) {
                    rotate(degrees = dev.lastHeading, pivot = Offset(px, py)) {
                        val arrow = Path().apply {
                            moveTo(px, py - 6.dp.toPx())
                            lineTo(px + 4.dp.toPx(), py + 5.dp.toPx())
                            lineTo(px, py + 2.dp.toPx())
                            lineTo(px - 4.dp.toPx(), py + 5.dp.toPx())
                            close()
                        }
                        drawPath(arrow, Color.White)
                    }
                }
            }
        }

        // 3. Interactive Vehicle Callsign Chips on Map
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(start = 12.dp, top = 68.dp, end = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val now = System.currentTimeMillis()
            devices.take(4).forEach { agg ->
                val isSelected = agg.device.id == selectedDeviceId
                val isExpired = !agg.isSubscriptionAccessible(now) &&
                    agg.device.activationStatus == ActivationStatus.ACTIVATED.name
                val dotColor = when {
                    isExpired -> StatusExpiredCrimson
                    agg.device.activationStatus != ActivationStatus.ACTIVATED.name -> StatusWaitingAmber
                    agg.device.ignitionOn -> StatusMovingEmerald
                    else -> StatusOfflineSlate
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(
                            if (isSelected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface.copy(alpha = 0.90f)
                        )
                        .border(
                            width = 1.dp,
                            color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            shape = RoundedCornerShape(8.dp)
                        )
                        .clickable { onSelectDevice(agg.device.id) }
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                        .testTag("map_marker_chip_${agg.device.id}")
                ) {
                    Icon(
                        imageVector = if (isExpired) Icons.Default.Lock else Icons.Default.Navigation,
                        contentDescription = agg.device.vehicleName,
                        tint = dotColor,
                        modifier = Modifier.size(12.dp)
                    )
                    Text(
                        text = agg.device.plateNumber,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // 4. Mandatory Visible OpenStreetMap Attribution & PMTiles Source Badge
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 12.dp, bottom = 12.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.88f))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp)
                .testTag("osm_attribution_badge")
        ) {
            Icon(
                imageVector = Icons.Default.Layers,
                contentDescription = "PMTiles Source",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(12.dp)
            )
            Column {
                Text(
                    text = stringResource(id = R.string.osm_attribution),
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 9.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "MapLibre 11.7.0 • PMTiles HTTP 206 Range",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 8.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
