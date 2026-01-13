# Inline Linking Guidelines

**Core principle:** The first time any place, service, or attraction is mentioned, link it immediately in the text. Don't make users hunt for links in summary sections — put them right where the information appears.

## Link at First Mention

Every location, venue, service, or attraction should be linked the **first time** it appears in the itinerary. This lets users immediately explore anything that catches their interest.

### Bad (links missing or delayed)

```markdown
#### Morning

- Drop off laundry at hotel service (~$40 USD per bag, same-day return)
- Relaxed morning in Vík
- Coffee at local café

#### Evening

- Pick up laundry
- Dinner in Vík

!Vík Church
```

### Good (inline links at first mention)

```markdown
#### Morning

- Drop off laundry at [Hotel Katla](https://hotelkatla.is) service ([~$40 USD per bag](https://hotelkatla.is/services/), same-day return)
- Relaxed morning in [Vík](https://www.google.com/maps/search/?api=1&query=Vík+Iceland)
- Coffee at [Skool Beans](https://www.google.com/maps/search/?api=1&query=Skool+Beans+Vík)

#### Evening

- Pick up laundry
- Dinner at [Strondin Bistro](https://www.google.com/maps/search/?api=1&query=Strondin+Bistro+Vík)
```

## Source Your Facts

When you mention specific prices, hours, policies, or other verifiable facts, link to the source. This builds trust and lets users verify details themselves.

### Bad (facts without sources)

```markdown
- Icelandic Lava Show in Vík (check showtimes - afternoon recommended)
  - Tickets cost around 5,900 ISK for adults
  - Shows run hourly from 10am-6pm
```

### Good (facts with sources)

```markdown
- [Icelandic Lava Show](https://icelandiclavashow.com) in Vík ([map](https://www.google.com/maps/search/?api=1&query=Icelandic+Lava+Show+Vík))
  - [Tickets: 5,900 ISK adults, 3,900 ISK children](https://icelandiclavashow.com/tickets/)
  - [Shows hourly 10am-6pm](https://icelandiclavashow.com/about/) — book ahead in summer
```

## Link Types

Use the right link for the context:

| Content | Link to |
|---------|---------|
| Place names (first mention) | Google Maps |
| Attractions/museums | Official website + Google Maps |
| Hotels | Official website or booking page |
| Restaurants | Google Maps (or website if notable) |
| Prices, hours, policies | Source page where you found the info |
| Services (laundry, tours, etc.) | Provider website or relevant page |

## Combining Official + Maps Links

When a venue has an official website worth visiting, link the name to the website and add a maps link:

```markdown
- Visit [Perlan Museum](https://perlan.is) ([map](https://www.google.com/maps/search/?api=1&query=Perlan+Reykjavik)) — [tickets from 4,490 ISK](https://perlan.is/tickets/)
```

For simpler locations (restaurants, cafés, beaches), just the maps link is often enough:

```markdown
- Lunch at [Coconut's Fish Cafe](https://www.google.com/maps/search/?api=1&query=Coconut%27s+Fish+Cafe+Kihei)
```

## Quick Reference Links (Optional)

You can still include a summary of key links at the end of a day section for quick reference, but these should **supplement** inline links, not replace them:

```markdown
#### Quick Links

- [Skaftafell](https://www.google.com/maps/search/?api=1&query=Skaftafell+Iceland) | [Park info](https://www.vatnajokulsthjodgardur.is/en/areas/skaftafell)
- [Svartifoss](https://www.google.com/maps/search/?api=1&query=Svartifoss+Iceland)
```

## Complete Example

```markdown
#### Morning

- Check out from [Hótel Jökulsárlón](https://hoteljokulsarlon.is) ([map](https://www.google.com/maps/search/?api=1&query=Hotel+Jokulsarlon+Iceland))
- Drive west to [Skaftafell](https://www.google.com/maps/search/?api=1&query=Skaftafell+Iceland) in [Vatnajökull National Park](https://www.vatnajokulsthjodgardur.is/en)

#### Afternoon

- **2-hour hike** to [Svartifoss waterfall](https://www.google.com/maps/search/?api=1&query=Svartifoss+Iceland)
  - Black waterfall surrounded by dramatic basalt columns
  - [Trail info: 5.5km round trip, moderate difficulty](https://www.vatnajokulsthjodgardur.is/en/areas/skaftafell/hiking-trails)
- Pack lunch or grab food at [Skaftafell Visitor Center café](https://www.google.com/maps/search/?api=1&query=Skaftafell+Visitor+Center)

#### Evening

- Continue drive to [Vík](https://www.google.com/maps/search/?api=1&query=Vík+Iceland) (~2 hours)
- Dinner at [Sudur Vík](https://www.google.com/maps/search/?api=1&query=Sudur+Vik+Restaurant) — known for lamb and fish dishes
```

## Key Takeaways

1. **First mention = first link** — don't wait for a summary section
2. **Source your facts** — prices, hours, and policies should link to where you found them
3. **Official sites for attractions** — let users explore, buy tickets, check hours
4. **Google Maps for navigation** — every physical location should be mappable
5. **Don't duplicate links** — once linked, subsequent mentions don't need links
