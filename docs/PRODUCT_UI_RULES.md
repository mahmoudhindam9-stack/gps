# VeloTrack — Permanent Product UI Rules

These rules are mandatory for every screen, dialog, bottom sheet, card, menu, empty state, notification, and future feature. Do not change them unless the product owner explicitly requests a change.

## No explanatory UI text

- Do not place explanatory sentences under, above, beside, or inside ordinary buttons.
- Do not add descriptions beneath section titles, page titles, cards, tabs, or form groups.
- Do not add onboarding paragraphs, instructional empty-state copy, help text, or ordinary-control tooltips.
- Do not explain what a button or section does in the interface.
- Prefer short labels, familiar icons, compact values, and concise state indicators.
- Errors may show one brief actionable message. Do not turn errors into tutorials.
- Keep technical documentation, setup instructions, and developer notes outside the customer-facing application UI.

## Examples

- Use `Activate`, not a paragraph explaining activation.
- Use `Devices`, not a descriptive section subtitle.
- Use compact states such as `ONLINE`, `OFFLINE`, `WAITING`, `EXPIRED`, and `FAILED`.
- Do not show sample/demo content merely to fill an empty screen.
- An empty state should remain visually clean, with only the minimum action label needed to add the first real record.

## Accessibility

Platform accessibility metadata such as Compose `contentDescription`, semantic roles, focus order, and screen-reader labels is allowed. This rule prohibits visible explanatory copy; it does not prohibit accessibility support.
