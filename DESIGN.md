---
name: Ranking Studio
description: A dark producer workspace that turns a topic into a reviewed vertical ranking video.
colors:
  background: "#0d1117"
  panel: "#121821"
  panel-raised: "#171f29"
  border: "#293440"
  border-strong: "#3b4855"
  text: "#f7f4ea"
  text-muted: "#9aa8b6"
  text-soft: "#c6d0d8"
  accent-gold: "#f2c94c"
  quote-hook-red: "#d3383d"
  quote-preview-neutral: "#857b73"
  accent-ink: "#171407"
  success: "#6bd39b"
  error: "#ff7b7b"
  link: "#83b9ff"
typography:
  display:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontSize: "31px"
    fontWeight: 700
    lineHeight: 1.24
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Be Vietnam Pro, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "7px"
  md: "10px"
  lg: "12px"
  xl: "15px"
  preview: "16px"
  round: "999px"
spacing:
  xs: "8px"
  sm: "10px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent-gold}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 17px"
    height: "43px"
  button-primary-hover:
    backgroundColor: "#ffda61"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 17px"
    height: "43px"
  prompt-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "22px 24px"
  workflow-step:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.lg}"
    padding: "13px 9px"
  workflow-step-active:
    backgroundColor: "#1b2430"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "13px 9px"
  status-tag:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "25px"
---

# Design System: Ranking Studio

## Overview

**Creative North Star: "The Producer's Rundown"**

Ranking Studio behaves like a focused production desk: dark, quiet, and organized around one linear handoff from topic to a sequential production queue. Horizontal rules, compact metadata, and numbered checkpoints make the interface feel like a working rundown rather than a collection of dashboard cards.

The visual hierarchy is restrained so the content review remains central. Warm ivory carries the reading voice, cool blue grays carry supporting information, and the gold accent appears only where the operator should act or orient themselves. The result should feel deliberate, trustworthy, and fast enough for daily use.

**Key Characteristics:**

- Dark navy workspace with subtle tonal separation between structural regions.
- Warm ivory typography rendered exclusively in Be Vietnam Pro for Vietnamese coverage.
- Ruled lists and tables that read like production paperwork.
- Gold reserved for the active step, the main action, and small progress cues.
- Compact status color used semantically for success, errors, forecasts, and source links.

## Colors

The palette combines near black navy surfaces with warm reading text and one controlled yellow signal.

### Primary

- **Studio Gold** (`accent-gold`): Primary actions, the current workflow marker, rank emphasis, progress, and short orientation rules.

### Secondary

- **Verified Mint** (`success`): Ready states, completed steps, and review confirmation.
- **Source Blue** (`link`): External sources, informational icons, and forecast status.
- **Signal Red** (`error`): Blocking failures and configuration problems.
- **Quote Hook Red** (`quote-hook-red`): The text panel inside Quote videos and their preview. It is content styling, not a control or error state.

### Neutral

- **Control Room** (`background`): Main canvas and deepest shared background.
- **Rundown Sheet** (`panel`): Inputs and content surfaces.
- **Raised Instrument** (`panel-raised`): Resting control fill and secondary surface emphasis.
- **Rule Line** (`border`) and **Strong Rule** (`border-strong`): Dividers, field outlines, and structural boundaries.
- **Warm Paper** (`text`): Primary reading color.
- **Slate Note** (`text-muted`) and **Soft Steel** (`text-soft`): Supporting copy and intermediate hierarchy.
- **Gold Ink** (`accent-ink`): Legible text and icons on gold controls.
- **Quote Preview Neutral** (`quote-preview-neutral`): Placeholder photo tone behind the sample hook panel before a real image is chosen.

### Named Rules

**The Single Signal Rule.** Gold belongs to one dominant action or active state within a local region. Its scarcity is what makes the workflow easy to scan.

**The Ruled Surface Rule.** Prefer border lines and tonal changes to boxed cards when organizing related rows, metadata, or review content.

## Typography

**Display Font:** Be Vietnam Pro (with Arial and sans-serif fallbacks)  
**Body Font:** Be Vietnam Pro (with Arial and sans-serif fallbacks)

**Character:** The same humanist sans serif carries every role, keeping Vietnamese text clear while weight, size, and spacing create hierarchy. Large headings are compact and confident; metadata is deliberately small and quiet.

### Hierarchy

- **Display:** Page level questions and the current task; tight tracking keeps long Vietnamese headings composed.
- **Headline:** Stage titles and render status headings.
- **Title:** Brand name, section titles, and strong row labels.
- **Body:** Default reading text and form content; keep supporting paragraphs short and operational.
- **Label:** Metadata, table headers, tags, and workflow counters; uppercase is limited to category labels and headers.

### Named Rules

**The One Family Rule.** Use Be Vietnam Pro throughout the product, including numeric and compact metadata roles; use weight and spacing instead of adding a display or monospace family.

## Layout

Desktop uses a three region shell: a 238px workflow rail, a fluid center workspace with a 520px minimum, and a 356px preview rail beneath a 70px top bar. The center column is capped at 1040px and uses fluid horizontal padding from 28px to 64px. The page should read from left to right as progress, work, then output.

At 1180px and below, remove the preview rail and keep the workflow rail beside the workspace. At 760px and below, collapse to one column: the 64px top bar remains visible, the workflow becomes a sticky four item strip, the workspace uses 18px side padding, and actions that complete a stage expand to full width. Dense idea metadata moves below its title, and result actions stack vertically.

Spacing follows an 8–30px operational rhythm. Use the smaller steps inside controls and rows, the middle steps between related groups, and the largest steps for stage and region separation.

## Elevation & Depth

The system is flat by default. Depth comes from neighboring navy tones and crisp one pixel rules; shadows are reserved for the 9:16 preview object and other elements that represent tangible output. State dots may use a soft colored halo to improve recognition, but working surfaces remain attached to the canvas.

### Shadow Vocabulary

- **Ambient Panel:** A broad, low contrast shadow for a visually independent output surface.
- **Preview Lift:** A deeper shadow for the phone preview, communicating that it contains the produced artifact.
- **Status Halo:** A small translucent ring around status dots, tinted by the corresponding semantic color.

### Named Rules

**The Flat Workflow Rule.** Use tonal layering and borders for navigation, forms, tables, and lists. Reserve substantial shadow for previewed output.

## Shapes

Corners are compact and functional. Small tags and source marks use the tightest radii; buttons and active workflow rows use medium corners; substantial fields and the phone preview use the largest corners. Circular geometry is reserved for step markers, radio controls, and status dots. Borders remain one pixel and visually quiet.

## Components

### Buttons

- **Shape:** Medium rounded rectangle with a 43px minimum touch height and compact horizontal padding.
- **Primary:** Studio Gold fill with Gold Ink copy; use for one stage advancing action.
- **Hover / Focus:** Hover brightens the gold or lifts a neutral button by one pixel. Keyboard focus uses a visible gold outline outside the component.
- **Ghost:** Transparent fill with a strong rule border for reversible or secondary actions.
- **Disabled:** Preserve the component silhouette and reduce opacity; do not replace the action with text.

### Chips

- **Style:** Compact outlined tags with Soft Steel text and no resting fill.
- **State:** Tint text and border with semantic status colors. Tags communicate actual, estimated, or forecast data and do not behave as decorative badges.

### Cards / Containers

- **Corner Style:** Large radii are reserved for the prompt field, notices, render symbol, and preview frame.
- **Background:** Use Rundown Sheet for editable surfaces and deeper navy tones for structural rails.
- **Shadow Strategy:** Follow the Flat Workflow Rule; the preview frame receives the strongest shadow.
- **Border:** One pixel Rule Line or Strong Rule establishes grouping.
- **Internal Padding:** Controls use compact spacing; major form surfaces use 18–24px.

### Inputs / Fields

- **Style:** The prompt is one unified panel containing the textarea, character count, and action footer.
- **Focus:** The full field border changes to Studio Gold through `:focus-within`; the textarea itself has no separate outline.
- **Error / Disabled:** Errors appear in a dedicated dark red notice above the active stage. Disabled controls remain visible at reduced opacity.

### Navigation

The primary rail names four durable destinations: Overview, Create, Automation, and Library. Create alone shows the five-step production sequence beneath the primary links. Each destination has a stable URL, while the creation steps have nested URLs. On narrow screens the primary links form a scrollable row above the compact step strip. Library provides search and publication-status filtering; video preview opens in a dialog when the preview rail is hidden.

Library results use a three-column grid on desktop, two columns on tablet, and one on phones. Each entry shows a cached frame from its vertical MP4, the title and publication status, a visible preview action, and a compact More menu for secondary actions.

The workflow is a numbered, stateful sequence. On desktop it is a vertical rail with label and helper copy; on mobile it becomes a sticky horizontal strip. The active step receives a raised navy row and a gold filled marker, completed steps turn mint, and locked future steps remain visible at reduced opacity.

### Rundown Rows

Quick prompts, idea options, and data rows share a ruled list language. They sit directly on the canvas, use horizontal dividers, and gain only a subtle navy tint on hover. Interactive rows move three pixels to the right as a directional cue.

### Production Queue

Selected ideas become numbered queue rows. Each row exposes one plain-language step, a linear progress track, and one semantic status. The queue processes one job at a time, keeps failed jobs visible, and lets completed rows open the 9:16 preview or download their MP4.

### Vertical Preview

The preview frame maintains a 9:16 aspect ratio and stays visually separate from the editing flow. Its empty state uses skeletal title and ranking rows so the future output is recognizable before rendering; metadata beneath it stays compact and aligned as label/value pairs.

## Do's and Don'ts

### Do:

- **Do** keep gold concentrated on the current state and the action that advances the workflow.
- **Do** organize repeated content with horizontal rules, compact rows, and shared alignment.
- **Do** preserve the three region desktop reading order and the sticky workflow strip on mobile.
- **Do** use semantic mint, red, and blue only when the status or source meaning is real.
- **Do** keep all Vietnamese interface text in Be Vietnam Pro with the bundled Vietnamese font files.

### Don't:

- **Don't** turn workflow content into a grid of floating statistic cards.
- **Don't** add gradients, decorative glass effects, or large shadows to ordinary working surfaces.
- **Don't** use gold as a general decoration or on several competing actions in the same region.
- **Don't** hide locked steps; their reduced opacity communicates the complete process and current position.
- **Don't** show the desktop preview rail below the established tablet breakpoint or compress it beside the mobile workspace.
