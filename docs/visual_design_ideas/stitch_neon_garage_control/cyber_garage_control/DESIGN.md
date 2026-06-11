---
name: Cyber Garage Control
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#849495'
  outline-variant: '#3a494b'
  surface-tint: '#00dbe7'
  primary: '#e1fdff'
  on-primary: '#00363a'
  primary-container: '#00f2ff'
  on-primary-container: '#006a71'
  inverse-primary: '#00696f'
  secondary: '#ffbc7c'
  on-secondary: '#4b2800'
  secondary-container: '#fe9400'
  on-secondary-container: '#633700'
  tertiary: '#eef9ff'
  on-tertiary: '#253238'
  tertiary-container: '#cfdde4'
  on-tertiary-container: '#546268'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#74f5ff'
  primary-fixed-dim: '#00dbe7'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#ffdcbf'
  secondary-fixed-dim: '#ffb874'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6a3b00'
  tertiary-fixed: '#d7e5ec'
  tertiary-fixed-dim: '#bbc9d0'
  on-tertiary-fixed: '#101d23'
  on-tertiary-fixed-variant: '#3c494f'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-state:
    fontFamily: Roboto Flex
    fontSize: 44px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.5px
  headline-md:
    fontFamily: Roboto Flex
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Roboto Flex
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.5px
  display-state-mobile:
    fontFamily: Roboto Flex
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  margin-edge: 24px
  gutter-v: 32px
  stack-tight: 8px
  stack-loose: 16px
  band-padding: 40px
---

## Brand & Style
This design system merges the structural logic of **Material 3** with a **Futuristic Neon** aesthetic. Designed for rapid, high-stakes interaction (controlling heavy machinery), the UI emphasizes state clarity through high-contrast accents and glowing depth. The personality is precise, technical, and authoritative—utilizing the "Material You" tonal mapping but shifting it into a high-saturation, dark-mode-only environment.

The visual language focuses on "The Three Bands":
1.  **Identity:** Minimalist status and branding.
2.  **State:** Large-scale, expressive visualization of the garage door.
3.  **Action:** High-affordance, color-coded interactive controls.

## Colors
The palette is centered on a deep **#121212** foundation to ensure maximum contrast for neon elements. 

- **Primary Neon (#00f2ff):** Used for active states, successful connections, and "Safe to Proceed" actions (e.g., Open/Close).
- **Caution Orange (#ff9500):** Reserved for "Stop" actions, "Opening/Closing" motion states, and non-critical warnings.
- **Surface Layering:** Surfaces utilize an elevated dark gray (#1c1c1c) to separate from the background.
- **Neon Glows:** Primary and Caution colors should employ a 15-25% opacity drop shadow/outer glow to simulate physical light emission.

## Typography
The system uses **Roboto Flex** for its variable weight capabilities, ensuring the door state is immediately legible from a distance. 

- **State Hierarchy:** The primary door status (e.g., "OPENING") uses `display-state` with a heavy weight.
- **Technical Readouts:** Sub-labels, Wi-Fi logs, and timestamps utilize **JetBrains Mono** to reinforce the "industrial/tech" narrative.
- **Alignment:** Center-alignment is preferred for the central "State" band, while technical logs are left-aligned for scannability.

## Layout & Spacing
The layout follows a **Vertical Stack** model divided into three distinct zones.

- **Identity Band:** Top 10% of the screen. Houses the app title and global settings.
- **State Band:** Central 50% of the screen. Contains the garage door schematic and the large state text. This area requires generous whitespace to focus the user's attention.
- **Action Band:** Bottom 40% of the screen. Houses the primary interaction FABs (Floating Action Buttons) or large segmented buttons.

**Responsive Adjustments:** On smaller devices, the "State Band" schematic scales down while maintaining the text size of the "Action Band" buttons for thumb-hit accessibility.

## Elevation & Depth
Elevation is signaled through a combination of **Tonal Layering** and **Neon Outer Glows**.

- **Level 0 (Background):** #0a0a0a (The base floor).
- **Level 1 (Main Card):** #1c1c1c with a subtle 1px border (#2c2c2c).
- **Level 2 (Interactive Elements):** Buttons and active chips.
- **Neon Depth:** When the door is in motion, the primary action button (e.g., "STOP") should emit a diffused glow using the Caution Orange (#ff9500) with a 24px blur at 30% opacity. This "Active Glow" replaces traditional Material shadows to fit the futuristic theme.

## Shapes
Following Material 3 guidelines, shapes are prominently rounded to feel modern and "human."

- **Main Container:** Uses `rounded-xl` (1.5rem / 24px) to create a contained, "app-within-an-app" feel on the dashboard.
- **Action Buttons:** Use `rounded-lg` (1rem / 16px). For split buttons (e.g., Open/Close pair), use sharp inner corners and rounded outer corners to maintain a unified visual unit.
- **Schematic Elements:** The garage door panels should have slight rounding (4px) to avoid a harsh brutalist look.

## Components
### Buttons
- **Primary Action:** Large, full-width buttons. Height: 64px. Font: `headline-md`. 
- **States:** Neon Blue for positive actions; Neon Orange for "Stop" or "Alert."
- **Visuals:** Filled background with high-contrast icons (Filled Material Symbols).

### Door Schematic
- A dynamic SVG component representing the door panels. 
- **Closed:** All panels filled with a subtle neutral gray.
- **Opening:** Panels slide upward with arrow indicators in Neon Blue.
- **Warning:** If a sensor is blocked, the relevant panel flashes Neon Orange.

### Chips & Technical Logs
- Used for Wi-Fi status and cloud connectivity.
- Style: Monospace text (`label-mono`) with a small leading dot indicator (Green for connected, Red for disconnected).

### Material Symbols
- Use "Rounded" or "Sharp" filled variants. 
- Icons should be scaled to 32px within action buttons for high visibility.