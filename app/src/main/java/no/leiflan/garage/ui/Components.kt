package no.leiflan.garage.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import no.leiflan.garage.api.ActionModel
import no.leiflan.garage.api.ActionModel.Tone
import no.leiflan.garage.ui.theme.CautionOrange
import no.leiflan.garage.ui.theme.ConnGreen
import no.leiflan.garage.ui.theme.ConnRed
import no.leiflan.garage.ui.theme.NeonCyan
import no.leiflan.garage.ui.theme.OnCyan
import no.leiflan.garage.ui.theme.OnOrange
import no.leiflan.garage.ui.theme.OnSurface
import no.leiflan.garage.ui.theme.OnSurfaceVar

private fun toneColor(t: Tone) = if (t == Tone.PRIMARY) NeonCyan else CautionOrange
private fun onToneColor(t: Tone) = if (t == Tone.PRIMARY) OnCyan else OnOrange

/** A diffused neon glow behind [content], the DESIGN.md "active glow" in place of a Material shadow. */
@Composable
private fun GlowBox(tone: Color, glow: Boolean, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier) {
        if (glow) {
            Box(
                Modifier.matchParentSize()
                    .blur(28.dp, BlurredEdgeTreatment.Unbounded)
                    .background(tone.copy(alpha = 0.30f), RoundedCornerShape(20.dp)),
            )
        }
        content()
    }
}

/** The morphing action button — one full-width neon button (open / close / stop / engage). */
@Composable
fun NeonActionButton(action: ActionModel.Action, enabled: Boolean, onCmd: (String) -> Unit, modifier: Modifier = Modifier) {
    val tone = toneColor(action.tone)
    GlowBox(tone, glow = enabled, modifier = modifier.fillMaxWidth()) {
        Surface(
            onClick = { if (enabled) onCmd(action.cmd) },
            enabled = enabled,
            shape = RoundedCornerShape(16.dp),
            color = tone.copy(alpha = if (enabled) 1f else 0.4f),
            contentColor = onToneColor(action.tone),
            modifier = Modifier.fillMaxWidth().height(64.dp),
        ) {
            Row(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterVertically) {
                if (action.arrow.isNotEmpty()) {
                    Text(action.arrow, style = MaterialTheme.typography.headlineMedium); Spacer(Modifier.width(10.dp))
                }
                Text(action.label, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** The STOPPED state: ONE wide button split by a divider into Open ｜ Close (not two buttons). */
@Composable
fun SplitActionButton(left: ActionModel.Action, right: ActionModel.Action, enabled: Boolean, onCmd: (String) -> Unit, modifier: Modifier = Modifier) {
    GlowBox(NeonCyan, glow = enabled, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().height(64.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(NeonCyan.copy(alpha = if (enabled) 1f else 0.4f)),
        ) {
            Half(left, enabled, onCmd, Modifier.weight(1f))
            Box(Modifier.width(1.5.dp).fillMaxHeight().background(OnCyan.copy(alpha = 0.35f)))
            Half(right, enabled, onCmd, Modifier.weight(1f))
        }
    }
}

@Composable
private fun Half(action: ActionModel.Action, enabled: Boolean, onCmd: (String) -> Unit, modifier: Modifier) {
    Box(
        modifier.fillMaxHeight().clickable(enabled = enabled) { onCmd(action.cmd) },
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (action.arrow.isNotEmpty()) { Text(action.arrow, color = OnCyan, style = MaterialTheme.typography.headlineMedium); Spacer(Modifier.width(8.dp)) }
            Text(action.label, color = OnCyan, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Identity band: brand wordmark (left) + a gear that opens Settings (right). */
@Composable
fun BrandBar(onSettings: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("▦", color = NeonCyan, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.width(10.dp))
            Text("GARAGE", color = OnSurface, style = MaterialTheme.typography.titleLarge)
        }
        Box(Modifier.size(40.dp).clickable(onClick = onSettings), contentAlignment = Alignment.Center) {
            Text("⚙", color = OnSurfaceVar, style = MaterialTheme.typography.titleLarge)
        }
    }
}

/** Connection footer: a status dot + transport label, then the mono history log (newest-first). */
@Composable
fun ConnectionFooter(headerLabel: String, online: Boolean, freshness: String, lines: List<String>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(if (online) ConnGreen else ConnRed))
            Spacer(Modifier.width(10.dp))
            Text(
                (headerLabel + "  " + freshness).uppercase(),
                color = if (online) NeonCyan else OnSurfaceVar,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        Spacer(Modifier.height(8.dp))
        lines.forEach { Text(it, color = OnSurfaceVar.copy(alpha = 0.6f), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 18.dp, top = 2.dp)) }
    }
}
