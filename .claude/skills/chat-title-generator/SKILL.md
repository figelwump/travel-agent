---
name: chat-title-generator
description: Generate a descriptive title for a travel planning chat conversation. Use when a conversation needs a better title based on its content.
model: haiku
allowed-tools: Read, Edit
---

# Chat Title Generator

Generate concise, descriptive titles for travel planning chat conversations based on message content.

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/chat-title-generator`

## Guidelines

- Titles should be **3-6 words maximum**
- Capture the **main topic or intent** of the conversation
- Use **action-oriented** language when appropriate (e.g., "Planning Rome Itinerary", "Adding Beach Days")
- Avoid generic titles like "Chat", "Planning", "Question"
- Be specific about destinations, activities, or topics discussed

## Good Title Examples

- "Tokyo Restaurant Recommendations"
- "Adding Hiking Day to Alps Trip"
- "Budget Review for Paris"
- "Flight Options to Barcelona"
- "Kid-Friendly Activities in London"
- "Extending Stay in Kyoto"
- "Hotel Change Request"
- "Visa Requirements for Vietnam"

## Bad Title Examples (Avoid These)

- "Planning" (too generic)
- "Question about itinerary" (vague)
- "Chat" (meaningless)
- "Help with trip" (too broad)
- "Travel stuff" (unhelpful)

## Workflow

1. **Analyze the conversation content** provided to you
2. **Identify the primary topic** - what is the user mainly asking about or discussing?
3. **Extract key specifics** - destinations, activities, dates, or concerns mentioned
4. **Generate a title** that is:
   - Specific to this conversation
   - 3-6 words
   - Immediately understandable at a glance

## Output Format

When generating a title, output ONLY the title text on a single line, nothing else. No quotes, no explanation, just the title.

Example output:
```
Adding Beach Days to Italy Trip
```

## Integration

This skill is designed to be called as a background sub-agent by the travel-planner skill after conversation exchanges. The generated title should be used to update the conversation metadata.
