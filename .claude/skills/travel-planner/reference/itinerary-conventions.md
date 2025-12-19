# Itinerary conventions

## Task list TODOs

Use standard markdown task list items:

- `- [ ] Book flights`
- `- [x] Reserve Blue Lagoon tickets`

The web UI renders these as interactive checkboxes and updates `itinerary.md` when toggled.

## Collapsible sections

For collapsible day sections, use:

```html
<details open>
<summary><strong>Day 2 — Golden Circle</strong></summary>

- Morning: …
- Afternoon: …

</details>
```

## Maps links

Prefer simple links (no embeds):

```markdown
[Map: Reykjavik](https://www.google.com/maps/search/?api=1&query=Reykjavik)
```

## Images

Use stable public URLs if possible (Wikimedia is often reliable). Example:

```markdown
![Reykjavik skyline](https://upload.wikimedia.org/...)
```

