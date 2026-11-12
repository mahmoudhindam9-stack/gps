package com.example.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
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
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.TelemetryCyanDark
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapView

/**
 * MapLibre Native Android (>= 11.7.0) + PMTiles Canvas.
 * Renders markers ONLY for devices that have received real valid GPS coordinates
 * (hasValidFix == true && lastLat != null && lastLng != null) and have an active subscription.
 * Shows zero markers when no real coordinates exist.
 */
@Composable
fun VeloTrackMapLibreCanvas(
    devices: List<DeviceAggregate>,
    selectedDeviceId: String?,
    userLocation: Pair<Double, Double>? = null,
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

    val now = System.currentTimeMillis()
    val positionedDevices = remember(devices, now) {
        devices.filter { agg ->
            agg.device.activationStatus == ActivationStatus.ACTIVATED.name &&
                agg.device.hasValidFix &&
                agg.device.lastLat != null &&
                agg.device.lastLng != null &&
                agg.isSubscriptionAccessible(now)
        }
    }

    val allLats = remember(positionedDevices, routeWaypoints, userLocation) {
        positionedDevices.mapNotNull { it.device.lastLat } +
            routeWaypoints.map { it.latitude } +
            listOfNotNull(userLocation?.first)
    }
    val allLngs = remember(positionedDevices, routeWaypoints, userLocation) {
        positionedDevices.mapNotNull { it.device.lastLng } +
            routeWaypoints.map { it.longitude } +
            listOfNotNull(userLocation?.second)
    }

    val minLat = (allLats.minOrNull() ?: 29.95) - 0.02
    val maxLat = (allLats.maxOrNull() ?: 30.15) + 0.02
    val minLng = (allLngs.minOrNull() ?: 31.15) - 0.02
    val maxLng = (allLngs.maxOrNull() ?: 31.35) + 0.02

    val selectedAggregate = remember(positionedDevices, selectedDeviceId) {
        positionedDevices.find { it.device.id == selectedDeviceId } ?: positionedDevices.firstOrNull()
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(if (isDarkTheme) Color(0xFF080D16) else Color(0xFFEAF1F8))
            .testTag("maplibre_canvas_container")
    ) {
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
                                val tileUrl = if (isDarkTheme) {
                                    "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
                                } else {
                                    "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                                }
                                val mapStyleJson = """
                                    {
                                      "version": 8,
                                      "name": "VeloTrack Map",
                                      "sources": {
                                        "raster-tiles": {
                                          "type": "raster",
                                          "tiles": [
                                            "$tileUrl"
                                          ],
                                          "tileSize": 256,
                                          "attribution": "© OpenStreetMap contributors"
                                        }
                                      },
                                      "layers": [
                                        {
                                          "id": "background",
                                          "type": "background",
                                          "paint": { "background-color": "$bgHex" }
                                        },
                                        {
                                          "id": "osm-tiles-layer",
                                          "type": "raster",
                                          "source": "raster-tiles",
                                          "minzoom": 0,
                                          "maxzoom": 19
                                        }
                                      ]
                                    }
                                """.trimIndent()
                                map.setStyle(org.maplibre.android.maps.Style.Builder().fromJson(mapStyleJson)) {
                                    val targetLat = selectedAggregate?.device?.lastLat ?: userLocation?.first ?: 30.0444
                                    val targetLng = selectedAggregate?.device?.lastLng ?: userLocation?.second ?: 31.2357
                                    val zoomLevel = if (selectedAggregate?.device?.lastLat != null || userLocation != null) 13.0 else 10.0
                                    map.cameraPosition = org.maplibre.android.camera.CameraPosition.Builder()
                                        .target(org.maplibre.android.geometry.LatLng(targetLat, targetLng))
                                        .zoom(zoomLevel)
                                        .build()
                                }
                                map.uiSettings.isAttributionEnabled = false
                                map.uiSettings.isLogoEnabled = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(positionedDevices) {
                    detectTapGestures { tapOffset ->
                        if (positionedDevices.isEmpty()) return@detectTapGestures
                        val width = size.width.toFloat().coerceAtLeast(1f)
                        val height = size.height.toFloat().coerceAtLeast(1f)
                        val latSpan = (maxLat - minLat).coerceAtLeast(0.001)
                        val lngSpan = (maxLng - minLng).coerceAtLeast(0.001)
                        val hit = positionedDevices.minByOrNull { agg ->
                            val lat = agg.device.lastLat ?: return@minByOrNull Float.MAX_VALUE
                            val lng = agg.device.lastLng ?: return@minByOrNull Float.MAX_VALUE
                            val x = ((lng - minLng) / lngSpan).toFloat() * width
                            val y = (1f - ((lat - minLat) / latSpan).toFloat()) * height
                            val dx = tapOffset.x - x
                            val dy = tapOffset.y - y
                            dx * dx + dy * dy
                        }
                        if (hit != null) {
                            onSelectDevice(hit.device.id)
                        }
                    }
                }
        ) {
            val w = size.width
            val h = size.height
            val gridColor = if (isDarkTheme) Color(0xFF152036) else Color(0xFFD5E2EE)
            val latSpan = (maxLat - minLat).coerceAtLeast(0.001)
            val lngSpan = (maxLng - minLng).coerceAtLeast(0.001)

            for (c in 1 until 8) {
                val x = (w / 8f) * c
                drawLine(gridColor, Offset(x, 0f), Offset(x, h), strokeWidth = 1.dp.toPx())
            }
            for (r in 1 until 10) {
                val y = (h / 10f) * r
                drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1.dp.toPx())
            }

            if (routeWaypoints.size >= 2) {
                val routePath = Path()
                routeWaypoints.forEachIndexed { idx, wp ->
                    val px = ((wp.longitude - minLng) / lngSpan).toFloat().coerceIn(0.05f, 0.95f) * w
                    val py = (1f - ((wp.latitude - minLat) / latSpan).toFloat().coerceIn(0.08f, 0.92f)) * h
                    if (idx == 0) routePath.moveTo(px, py) else routePath.lineTo(px, py)
                }
                drawPath(
                    path = routePath,
                    color = TelemetryCyanDark,
                    style = Stroke(
                        width = 3.dp.toPx(),
                        cap = StrokeCap.Round,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(16f, 8f), 0f)
                    )
                )
                routeWaypoints.forEachIndexed { idx, wp ->
                    val px = ((wp.longitude - minLng) / lngSpan).toFloat().coerceIn(0.05f, 0.95f) * w
                    val py = (1f - ((wp.latitude - minLat) / latSpan).toFloat().coerceIn(0.08f, 0.92f)) * h
                    drawCircle(
                        color = if (idx == activeWaypointIndex) StatusMovingEmerald else TelemetryCyanDark,
                        radius = if (idx == activeWaypointIndex) 7.dp.toPx() else 4.dp.toPx(),
                        center = Offset(px, py)
                    )
                }
            }

            // Draw current device user location marker if present
            userLocation?.let { (uLat, uLng) ->
                val px = ((uLng - minLng) / lngSpan).toFloat().coerceIn(0.05f, 0.95f) * w
                val py = (1f - ((uLat - minLat) / latSpan).toFloat().coerceIn(0.08f, 0.92f)) * h
                drawCircle(
                    color = Color(0xFF2196F3).copy(alpha = 0.25f),
                    radius = 22.dp.toPx(),
                    center = Offset(px, py)
                )
                drawCircle(
                    color = Color.White,
                    radius = 8.dp.toPx(),
                    center = Offset(px, py)
                )
                drawCircle(
                    color = Color(0xFF1976D2),
                    radius = 6.dp.toPx(),
                    center = Offset(px, py)
                )
            }

            // Only draw markers for devices with real server-confirmed coordinates
            positionedDevices.forEach { agg ->
                val dev = agg.device
                val lat = dev.lastLat ?: return@forEach
                val lng = dev.lastLng ?: return@forEach
                val px = ((lng - minLng) / lngSpan).toFloat().coerceIn(0.08f, 0.92f) * w
                val py = (1f - ((lat - minLat) / latSpan).toFloat().coerceIn(0.12f, 0.86f)) * h
                val isSelected = dev.id == selectedDeviceId
                val markerColor = if (dev.ignitionOn == true) StatusMovingEmerald else StatusOfflineSlate

                if (isSelected) {
                    drawCircle(
                        color = markerColor.copy(alpha = 0.24f),
                        radius = 24.dp.toPx(),
                        center = Offset(px, py)
                    )
                }
                drawCircle(
                    color = if (isDarkTheme) Color(0xFF0B0F17) else Color.White,
                    radius = 13.dp.toPx(),
                    center = Offset(px, py)
                )
                drawCircle(
                    color = markerColor,
                    radius = 10.dp.toPx(),
                    center = Offset(px, py)
                )
                rotate(degrees = dev.lastHeading ?: 0f, pivot = Offset(px, py)) {
                    val arrow = Path().apply {
                        moveTo(px, py - 5.dp.toPx())
                        lineTo(px + 3.5.dp.toPx(), py + 4.dp.toPx())
                        lineTo(px, py + 1.5.dp.toPx())
                        lineTo(px - 3.5.dp.toPx(), py + 4.dp.toPx())
                        close()
                    }
                    drawPath(arrow, Color.White)
                }
            }
        }

        if (positionedDevices.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = 12.dp, top = 58.dp, end = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                positionedDevices.take(4).forEach { agg ->
                    val isSelected = agg.device.id == selectedDeviceId
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
                            imageVector = Icons.Default.Navigation,
                            contentDescription = agg.device.vehicleName,
                            tint = if (agg.device.ignitionOn == true) StatusMovingEmerald else StatusOfflineSlate,
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
        }

        // Mandatory Visible OpenStreetMap Attribution Badge
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 10.dp, bottom = 10.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.88f))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp)
                .testTag("osm_attribution_badge")
        ) {
            Icon(
                imageVector = Icons.Default.Layers,
                contentDescription = stringResource(id = R.string.osm_attribution),
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(12.dp)
            )
            Text(
                text = stringResource(id = R.string.osm_attribution),
                fontFamily = JetBrainsMonoFontFamily,
                fontSize = 9.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
