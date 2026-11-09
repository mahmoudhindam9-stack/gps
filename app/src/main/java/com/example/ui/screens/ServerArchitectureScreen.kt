package com.example.ui.screens

import androidx.compose.foundation.border
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
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.BackendConnectionState
import com.example.data.repository.ServerStatusSnapshot
import com.example.ui.theme.JetBrainsMonoFontFamily
import com.example.ui.theme.StatusExpiredCrimson
import com.example.ui.theme.StatusMovingEmerald
import com.example.ui.theme.StatusOfflineSlate
import com.example.ui.theme.StatusWaitingAmber

@Composable
fun ServerArchitectureScreen(
    serverUrlInput: String,
    serverStatus: ServerStatusSnapshot,
    onUpdateServerUrl: (String) -> Unit,
    onCheckHealth: () -> Unit,
    onSyncTraccar: () -> Unit,
    modifier: Modifier = Modifier
) {
    val connColor = when (serverStatus.connectionState) {
        BackendConnectionState.CONNECTED -> StatusMovingEmerald
        BackendConnectionState.CONNECTING, BackendConnectionState.RECONNECTING -> StatusWaitingAmber
        BackendConnectionState.UNAUTHORIZED -> StatusExpiredCrimson
        BackendConnectionState.DISCONNECTED -> StatusOfflineSlate
    }

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
            Text(
                text = "Server",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            StatusPill(
                text = serverStatus.connectionState.shortLabel,
                color = connColor
            )
        }

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
                OutlinedTextField(
                    value = serverUrlInput,
                    onValueChange = onUpdateServerUrl,
                    label = { Text("Backend URL") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("server_url_input")
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "SUPABASE DB",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp
                    )
                    StatusPill(
                        text = if (serverStatus.supabaseConnected) "ONLINE" else "OFFLINE",
                        color = if (serverStatus.supabaseConnected) StatusMovingEmerald else StatusOfflineSlate
                    )
                }

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
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "TRACCAR BRIDGE",
                            fontFamily = JetBrainsMonoFontFamily,
                            fontSize = 11.sp
                        )
                    }
                    StatusPill(
                        text = if (serverStatus.traccarBridgeConnected) "ONLINE" else "OFFLINE",
                        color = if (serverStatus.traccarBridgeConnected) StatusMovingEmerald else StatusOfflineSlate
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "LIVE WS",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp
                    )
                    StatusPill(
                        text = if (serverStatus.liveWsConnected) "LIVE" else "OFFLINE",
                        color = if (serverStatus.liveWsConnected) StatusMovingEmerald else StatusOfflineSlate
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "SMS GATEWAY",
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp
                    )
                    StatusPill(
                        text = if (serverStatus.smsGatewayConfigured) "READY" else "UNCONFIGURED",
                        color = if (serverStatus.smsGatewayConfigured) StatusMovingEmerald else StatusWaitingAmber
                    )
                }

                if (serverStatus.lastErrorMessage != null) {
                    Text(
                        text = serverStatus.lastErrorMessage,
                        fontFamily = JetBrainsMonoFontFamily,
                        fontSize = 11.sp,
                        color = StatusExpiredCrimson
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onCheckHealth,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp)
                            .testTag("btn_check_server_health")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Health", fontSize = 11.sp)
                    }
                    OutlinedButton(
                        onClick = onSyncTraccar,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp)
                            .testTag("btn_sync_traccar")
                    ) {
                        Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Sync", fontSize = 11.sp)
                    }
                }
            }
        }
    }
}
