package com.example.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = TelemetryCyanDark,
    onPrimary = Color(0xFF001E2F),
    primaryContainer = Color(0xFF073752),
    onPrimaryContainer = Color(0xFFBDE9FF),
    secondary = AdminIndigoDark,
    onSecondary = Color(0xFF1E1B4B),
    secondaryContainer = Color(0xFF2E2A6E),
    onSecondaryContainer = Color(0xFFE0E7FF),
    tertiary = StatusMovingEmerald,
    onTertiary = Color(0xFF002114),
    background = ObsidianBackground,
    onBackground = TextPrimaryDark,
    surface = ObsidianSurface,
    onSurface = TextPrimaryDark,
    surfaceVariant = ObsidianSurfaceVariant,
    onSurfaceVariant = TextSecondaryDark,
    outline = ObsidianBorder,
    error = StatusExpiredCrimson,
    onError = Color.White
)

private val LightColorScheme = lightColorScheme(
    primary = TelemetryCyanLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0F2FE),
    onPrimaryContainer = Color(0xFF075985),
    secondary = AdminIndigoLight,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE0E7FF),
    onSecondaryContainer = Color(0xFF312E81),
    tertiary = StatusMovingEmerald,
    onTertiary = Color.White,
    background = DaylightBackground,
    onBackground = TextPrimaryLight,
    surface = DaylightSurface,
    onSurface = TextPrimaryLight,
    surfaceVariant = DaylightSurfaceVariant,
    onSurfaceVariant = TextSecondaryLight,
    outline = DaylightBorder,
    error = StatusExpiredCrimson,
    onError = Color.White
)

@Composable
fun VeloTrackTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}

@Composable
fun MyApplicationTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    VeloTrackTheme(darkTheme = darkTheme, content = content)
}
