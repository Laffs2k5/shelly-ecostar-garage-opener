package no.leiflan.garage.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import no.leiflan.garage.ui.theme.NeonCyan
import no.leiflan.garage.ui.theme.PanelGray

/**
 * The "State band" — a neon door schematic that reflects the door state (DESIGN.md). We have only
 * direction (reed + motor), no position, so motion is an INDETERMINATE looping slide, never a progress
 * bar. Closed = panel fills the opening; Open = panel retracted to a header; Opening/Closing = animated;
 * Stopped = panel held at ~half; Unknown = dim.
 */
@Composable
fun DoorSchematic(state: String?, modifier: Modifier = Modifier) {
    val opening = state == "OPENING"
    val closing = state == "CLOSING"
    val moving = opening || closing

    val infinite = rememberInfiniteTransition(label = "door-motion")
    val motion by infinite.animateFloat(
        initialValue = 0.08f, targetValue = 0.95f,
        animationSpec = infiniteRepeatable(tween(1700), RepeatMode.Restart), label = "motion",
    )
    val target = when (state) {
        "OPEN" -> 1f
        "CLOSED" -> 0f
        "STOPPED_OPENING", "STOPPED_CLOSING" -> 0.5f
        else -> 0f
    }
    val settled by animateFloatAsState(target, tween(450), label = "settled")
    val fraction = when {
        opening -> motion
        closing -> 1f - motion
        else -> settled
    }
    val dim = state == null || state == "UNKNOWN"

    Canvas(modifier) {
        val w = size.width; val h = size.height
        val left = w * 0.10f; val right = w * 0.90f
        val top = h * 0.10f; val openBottom = h * 0.72f
        val openH = openBottom - top
        val baseAlpha = if (dim) 0.30f else 1f

        drawFloorGrid(left, right, openBottom, h, baseAlpha)

        // door opening — neon outline with a diffused glow (wide translucent under a solid thin stroke)
        val rectTL = Offset(left, top); val rectSize = Size(right - left, openH)
        val cr = CornerRadius(8f, 8f)
        drawRoundRect(NeonCyan.copy(alpha = 0.18f * baseAlpha), rectTL, rectSize, cr, style = Stroke(width = 16f))
        drawRoundRect(NeonCyan.copy(alpha = baseAlpha), rectTL, rectSize, cr, style = Stroke(width = 3f))

        // door panel — retracts upward as fraction -> 1
        val panelH = openH * (1f - fraction)
        if (panelH > 2f) {
            drawRoundRect(
                PanelGray.copy(alpha = baseAlpha),
                topLeft = Offset(left + 3f, top + 1.5f),
                size = Size(right - left - 6f, panelH - 3f),
                cornerRadius = CornerRadius(4f, 4f),
            )
            // horizontal segment lines
            val segs = 4
            for (i in 1 until segs) {
                val y = top + panelH * i / segs
                if (y < top + panelH - 4f) {
                    drawLine(NeonCyan.copy(alpha = 0.10f * baseAlpha), Offset(left + 6f, y), Offset(right - 6f, y), strokeWidth = 1.5f)
                }
            }
            // handle notch near the panel's bottom edge (visible when mostly closed)
            if (fraction < 0.4f) {
                val hy = top + panelH - 14f
                drawLine(NeonCyan.copy(alpha = 0.5f * baseAlpha), Offset(w * 0.46f, hy), Offset(w * 0.54f, hy), strokeWidth = 5f)
            }
        }

        // motion chevrons in the revealed opening, pointing the way of travel
        if (moving) {
            val cx = w * 0.5f
            val revealedTop = top + panelH
            for (i in 0 until 3) {
                val a = (0.7f - i * 0.2f)
                val cy = revealedTop + 18f + i * 22f
                if (cy < openBottom - 6f) drawChevron(cx, cy, up = opening, alpha = a)
            }
        }
    }
}

private fun DrawScope.drawFloorGrid(left: Float, right: Float, top: Float, bottom: Float, alpha: Float) {
    val c = NeonCyan.copy(alpha = 0.22f * alpha)
    val cx = (left + right) / 2f
    val rows = 5
    for (i in 0..rows) {
        val t = i.toFloat() / rows
        val y = top + (bottom - top) * t * t   // ease for perspective compression
        drawLine(c, Offset(left, y), Offset(right, y), strokeWidth = 1f)
    }
    val cols = 6
    for (i in 0..cols) {
        val x = left + (right - left) * i / cols
        // converge toward the centre at the far (top) edge
        val farX = cx + (x - cx) * 0.45f
        drawLine(c, Offset(x, bottom), Offset(farX, top), strokeWidth = 1f)
    }
}

private fun DrawScope.drawChevron(cx: Float, cy: Float, up: Boolean, alpha: Float) {
    val c = NeonCyan.copy(alpha = alpha.coerceIn(0f, 1f))
    val half = 12f; val rise = 8f
    val tip = if (up) cy - rise else cy + rise
    val tail = if (up) cy else cy - rise + rise
    drawLine(c, Offset(cx - half, tail), Offset(cx, tip), strokeWidth = 3f)
    drawLine(c, Offset(cx + half, tail), Offset(cx, tip), strokeWidth = 3f)
}
