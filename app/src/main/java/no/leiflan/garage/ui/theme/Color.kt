package no.leiflan.garage.ui.theme

import androidx.compose.ui.graphics.Color

// Cyber Garage Control palette — docs/visual_design_ideas/.../cyber_garage_control/DESIGN.md.
// Dark-only, neon. Cyan = safe/positive (open/close/connected); orange = caution (stop/motion).
val NeonCyan = Color(0xFF00F2FF)
val NeonCyanDim = Color(0xFF00DBE7)
val OnCyan = Color(0xFF00363A)
val CautionOrange = Color(0xFFFF9500)
val OnOrange = Color(0xFF4B2800)

val BgBase = Color(0xFF0A0A0A)          // level 0 — the floor
val Surface0 = Color(0xFF121212)
val Surface1 = Color(0xFF1C1C1C)        // level 1 — main card
val Surface2 = Color(0xFF201F1F)
val OutlineGray = Color(0xFF849495)     // visible field/border outline (DESIGN.md `outline`)
val OutlineFaint = Color(0xFF2C2C2C)    // subtle 1px card border (level-1)
val PanelGray = Color(0xFF393939)       // door-panel fill in the schematic

val OnSurface = Color(0xFFE5E2E1)
val OnSurfaceVar = Color(0xFFB9CACB)

val ConnGreen = Color(0xFF3FD16B)       // connected dot
val ConnRed = Color(0xFFFF6B6B)         // offline dot
val ErrorRed = Color(0xFFFFB4AB)
