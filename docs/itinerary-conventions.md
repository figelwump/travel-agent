# Itinerary conventions

## Task list TODOs

Use standard markdown task list items:

- `- [ ] Book flights`
- `- [x] Reserve Blue Lagoon tickets`

The web UI renders these as interactive checkboxes and updates `itinerary.md` when toggled.

## Activity formatting

ALL activities within time periods MUST be bullet list items:

```markdown
#### Morning

- Arrive at [Kahului Airport (OGG)](https://www.google.com/maps/search/?api=1&query=Kahului+Airport+OGG)
- Pick up rental car
- Drive to [Wailea](https://www.google.com/maps/search/?api=1&query=Wailea+Maui+Hawaii)
- Check-in and settle in
```

**Do NOT use plain paragraphs for activities** — always use bullet lists.

## Linking

See **`inline-linking.md`** for comprehensive linking guidelines.

Key points:
- Link places/venues **inline at first mention** — don't make users hunt for links
- Source facts (prices, hours) with links to where you found them
- Use Google Maps for locations, official websites for attractions
- Format: `[Location](https://www.google.com/maps/search/?api=1&query=Location+City)`

## Images

Include 2-3 images per day showing key locations/activities. Use stable public URLs (Wikimedia/Wikipedia preferred):

```markdown
![Kahului Airport](https://upload.wikimedia.org/wikipedia/commons/...)
![Wailea Beach sunset](https://upload.wikimedia.org/wikipedia/commons/...)
```

Images can be placed at the top of the day section or inline near relevant activities.

## Trip map

For multi-destination trips (2+ stops), maintain a `## Destinations` section with an ordered bullet list using `-` (no numbering, no checkboxes). This list is used to generate the trip map. Use the `generate_trip_map` tool to create or refresh the map, which will insert a `![Trip map](...)` image into the itinerary.
Do not manually add a trip map image or section; the tool inserts the canonical map line.

Example:

```markdown
## Destinations

- Tokyo
- Kyoto
- Osaka
```

## Collapsible sections

For collapsible day sections, use:

```html
<details open>
<summary><strong>Day 2 — Golden Circle</strong></summary>

...day content...

</details>
```

## Per-day subsections

EVERY day must include Accommodation and Tickets & Reservations subsections.

### Accommodation

Include hotel/lodging details if known, or TODOs if not:

```markdown
#### Accommodation

- **Hotel:** [Grand Wailea Resort](https://www.google.com/maps/search/?api=1&query=Grand+Wailea+Resort+Maui)
- **Address:** 3850 Wailea Alanui Dr, Wailea, HI 96753
- **Phone:** (808) 875-1234
- **Confirmation:** ABC123
```

If booking details are unknown:

```markdown
#### Accommodation

- [ ] Book hotel in Wailea/Kihei area
```

### Tickets & Reservations

Include activity tickets and reservations for that day:

```markdown
#### Tickets & Reservations

- **Snorkel tour:** Booked with Molokini Tours, 9am pickup
- **Dinner:** [Mama's Fish House](https://www.google.com/maps/search/?api=1&query=Mama%27s+Fish+House+Paia) — 7pm, confirmation #12345
- [ ] Reserve luau tickets
```

If no reservations needed:

```markdown
#### Tickets & Reservations

- No reservations needed — beach day!
```

## Complete day example

```markdown
## Trip Map

![Trip map](/api/trips/<tripId>/assets/itinerary-map.png)

<details open>
<summary><strong>Day 1 — Saturday, April 5: Arrival & Settling In</strong></summary>

![Kahului Airport](https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Kahului_Airport_Terminal.jpg/1200px-Kahului_Airport_Terminal.jpg)
![Wailea Beach](https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Wailea_Beach%2C_Maui.jpg/1200px-Wailea_Beach%2C_Maui.jpg)

#### Morning/Afternoon

- Arrive at [Kahului Airport (OGG)](https://www.google.com/maps/search/?api=1&query=Kahului+Airport+OGG)
- Pick up rental car from [Alamo](https://www.alamo.com) at airport
- Drive to [Wailea](https://www.google.com/maps/search/?api=1&query=Wailea+Maui+Hawaii) (~30 min)
- Check in at [Grand Wailea Resort](https://www.grandwailea.com) ([map](https://www.google.com/maps/search/?api=1&query=Grand+Wailea+Resort+Maui))

#### Evening

- Sunset beach walk at [Wailea Beach](https://www.google.com/maps/search/?api=1&query=Wailea+Beach+Maui) or [Kamaole Beach Park](https://www.google.com/maps/search/?api=1&query=Kamaole+Beach+Park+Kihei)
- Casual dinner at [Coconut's Fish Cafe](https://www.google.com/maps/search/?api=1&query=Coconut%27s+Fish+Cafe+Kihei) — fresh poke and fish tacos

#### Accommodation

- **Hotel:** [Grand Wailea Resort](https://www.grandwailea.com) ([map](https://www.google.com/maps/search/?api=1&query=Grand+Wailea+Resort+Maui))
- **Address:** 3850 Wailea Alanui Dr, Wailea, HI 96753
- **Phone:** (808) 875-1234
- **Confirmation:** TBD
- [ ] Confirm hotel reservation

#### Tickets & Reservations

- [ ] Reserve dinner at Coconut's Fish Cafe
- [ ] Confirm rental car pickup time

**Notes:** Keep it light on arrival day. Rest up for the adventures ahead!

</details>
```
