package no.leiflan.garage.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

// Cyber Garage Control — dark-only Material 3 + neon. Glows are drawn in the components (Modifier.blur),
// not via the colour scheme.
private val CyberColors = darkColorScheme(
    primary = NeonCyan,
    onPrimary = OnCyan,
    primaryContainer = NeonCyanDim,
    onPrimaryContainer = OnCyan,
    secondary = CautionOrange,
    onSecondary = OnOrange,
    secondaryContainer = CautionOrange,
    onSecondaryContainer = OnOrange,
    background = BgBase,
    onBackground = OnSurface,
    surface = Surface0,
    onSurface = OnSurface,
    surfaceVariant = Surface1,
    onSurfaceVariant = OnSurfaceVar,
    outline = OutlineGray,
    error = ErrorRed,
)

@Composable
fun GarageTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = CyberColors, typography = CyberType, content = content)
}
