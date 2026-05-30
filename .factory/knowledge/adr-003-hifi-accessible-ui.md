# ADR-003: High-Fidelity & Accessible UI Design System

* **Status**: Implemented / Approved
* **Date**: 2026-05-30
* **Authors**: Antigravity, Factory Core Engineering Team
* **Scope**: UI Design, Styling, Responsive Grid Layouts, WCAG Accessibility

---

## Context & Problem Statement

The initial Factory dashboard used standard Tailwind utility layouts and basic gray cards. Feedback from expert usability and design system reviews highlighted several issues:
1. **Dull/Generic Palette**: The interface lacked visual premium styling, relying on browser default typography and standard colors.
2. **Accessibility (WCAG) Defects**: White-on-white text bugs rendered the main story Build buttons unreadable under certain screen modes.
3. **Flushed & Stretched Spacing**: Sidebars and layout controls were vertically compressed and stretched horizontally across larger viewport resolutions, creating layout fatigue.

---

## Decision & Approach

We decided to execute a comprehensive **High-Fidelity & Accessible Visual Redesign** of the Next.js UI using modern dark-mode aesthetics and WCAG standards.

### 1. HSL-Tailored Color Palette & Sleek Aesthetics
Replaced plain colors with vibrant dark-themed HSL tokens, smooth gradients, and glassmorphism styling. Upgraded default typography to modern Google Fonts (such as Outfit and Inter) to create a premium appearance.

### 2. High-Contrast Accessibility Upgrades
Fixed contrast bugs by replacing low-visibility elements with high-contrast alternatives. For example, primary actions (like Build gates) were upgraded to high-visibility indigo block layouts, passing WCAG AAA text contrast standards.

### 3. Responsive Desktop & Mobile Grid Shell
Constrained layout stretched sidebars by limiting layout widths, introducing clean CSS gap paddings, and refactoring stretched backlog details panels into minimalist sliding Sheets and dialogs.

### 4. Interactive State Polish & Micro-Animations
Added hover highlights, smooth card transitions, and dynamic sidebar active state pills. The active model overrides list now uses mobile-first responsive grids that display preferences in clean sheets.

---

## Consequences

* **Visual Polish**: The dashboard looks modern, interactive, and fits the developer-oriented build platform style.
* **Flawless Usability**: Controls are clear, with zero contrast bugs or white-on-white readability issues.
* **Layout Adaptability**: Spacing, margins, and drawers render cleanly on both mobile viewport and widescreen 4K displays.
