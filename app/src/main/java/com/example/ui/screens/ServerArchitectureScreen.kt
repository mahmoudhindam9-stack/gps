package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.blueprint.SelfHostedServerBlueprints
import com.example.data.repository.GatewayRuntimeStatus
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusWaitingAmber

@Composable
fun ServerArchitectureScreen(
    gatewayStatus: GatewayRuntimeStatus,
    onReconnectTraccarBridge: () -> Unit,
    onUpdateRetentionDays: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val clipboard = LocalClipboardManager.current
    val blueprints = SelfHostedServerBlueprints.blueprints
    var selectedBlueprintId by remember { mutableStateOf(blueprints.first().id) }
    val activeDoc = blueprints.find { it.id == selectedBlueprintId } ?: blueprints.first()

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
            .testTag("server_architecture_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                Text(
                    text = "Self-Hosted VPS Stack",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Zero Paid SaaS • 16GB RAM Baseline • Dual PostgreSQL",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            StatusPill(text = "SELF-HOSTED", color = StatusMovingEmerald)
        }

        // 1. Live Traccar Session Cookie Bridge & GSM Modem Gateway Status
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
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
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Dns,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "TRACCAR WS BRIDGE & GSM GATEWAY",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    StatusPill(
                        text = if (gatewayStatus.traccarWsConnected) "WS CONNECTED" else "RECONNECTING",
                        color = if (gatewayStatus.traccarWsConnected) StatusMovingEmerald else StatusWaitingAmber
                    )
                }

                Text(
                    text = "Cookie: ${gatewayStatus.traccarSessionCookie} • event.status.enable=${gatewayStatus.eventStatusEnabled}",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 10.sp
                )
                Text(
                    text = "GSM Modem (WireGuard): ${gatewayStatus.gsmModemSimNumber} (${gatewayStatus.gsmModemSignalDbm} dBm)",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (gatewayStatus.lastExpiryCutoffEvent != null) {
                    Text(
                        text = "Last Cutoff: ${gatewayStatus.lastExpiryCutoffEvent}",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp,
                        color = StatusWaitingAmber
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onReconnectTraccarBridge,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 38.dp)
                            .testTag("btn_reconnect_traccar_ws")
                    ) {
                        Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Renew JSESSIONID & Sync", fontSize = 11.sp)
                    }
                }
            }
        }

        // 2. VPS Sizing Baseline (16GB Production vs 8GB Pilot) & Controlled 180-Day Retention
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Memory,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "VPS SIZING & CONTROLLED BATCHED RETENTION",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                Text(
                    text = "• Provisional Production Baseline: 8 vCPU / 16 GB RAM / 240 GB NVMe\n" +
                        "  (Supabase ~5.5GB + Traccar JVM 3.5GB + 2x Postgres + NestJS + Caddy)\n" +
                        "• Pilot / Dev Tier Only: 4 vCPU / 8 GB RAM (Not sized for production)",
                    fontFamily = JetBrainsMonoFontFamily,
                    fontSize = 10.sp
                )

                Text(
                    text = "Traccar DB Batched Retention Policy (Pre-Backup Verified):",
                    style = MaterialTheme.typography.labelLarge
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    listOf(90, 180, 365).forEach { days ->
                        FilterChip(
                            selected = gatewayStatus.retentionDays == days,
                            onClick = { onUpdateRetentionDays(days) },
                            label = { Text("${days} Days") },
                            modifier = Modifier.testTag("retention_chip_${days}")
                        )
                    }
                }
            }
        }

        // 3. Production Server Configuration Blueprints Inspector
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "PRODUCTION SERVER DEPLOYMENT FILES",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                ) {
                    blueprints.forEach { doc ->
                        FilterChip(
                            selected = doc.id == selectedBlueprintId,
                            onClick = { selectedBlueprintId = doc.id },
                            label = { Text(doc.filename) },
                            modifier = Modifier.testTag("blueprint_chip_${doc.id}")
                        )
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = activeDoc.title,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = activeDoc.subtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(activeDoc.content))
                        },
                        modifier = Modifier
                            .heightIn(min = 36.dp)
                            .testTag("copy_blueprint_button")
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Copy", fontSize = 11.sp)
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .padding(10.dp)
                ) {
                    Text(
                        text = activeDoc.content,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 10.sp,
                        lineHeight = 14.sp
                    )
                }
            }
        }
    }
}
