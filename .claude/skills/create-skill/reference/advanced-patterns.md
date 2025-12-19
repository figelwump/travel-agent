# Advanced Skill Patterns

## Complex Workflow with Session State

For skills that process data through multiple steps, use a session-based workspace pattern:

```markdown
## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/my-processor`

**Workspace root:** `/var/data/skills/tmp/my-processor`

**Choose a session slug once at the start** (e.g., `process-20251120`) and remember it throughout the workflow.

Throughout this workflow, **`$WORKDIR`** refers to: `/var/data/skills/tmp/my-processor/<slug>`

When executing commands, replace `$WORKDIR` with the full path using your chosen slug.

**Before starting, create the workspace directory once:**
\`\`\`bash
mkdir -p $WORKDIR
\`\`\`
```

## Multi-Phase Workflows

Structure complex skills with distinct phases:

```markdown
## Workflow (Sequential Loop)

Process items one at a time. For each item, complete the full loop before proceeding.

### Phase 1: Data Collection
\`\`\`bash
command-to-fetch-data > $WORKDIR/input.csv
\`\`\`

### Phase 2: Processing
\`\`\`bash
process-command --input $WORKDIR/input.csv --output $WORKDIR/processed.csv
\`\`\`

### Phase 3: Validation
\`\`\`bash
validate-command $WORKDIR/processed.csv
\`\`\`
```

## Decision Trees

Help agents choose between approaches:

```markdown
## Decision Tree: Approach Selection

1. **Use approach A** when:
   - Condition X applies
   - User requests Y
   - Data has characteristic Z

2. **Use approach B** when:
   - Different condition applies
   - Alternative scenario

3. **Always check** `$SKILL_ROOT/reference/options.md` before proceeding
```

## Scenario-Based Sections

For skills with multiple use cases:

```markdown
## Scenario: Bulk Update

When the user asks to update multiple items at once:

1. **Query affected items**
   \`\`\`bash
   query-command --filter "pattern"
   \`\`\`

2. **Preview changes**
   \`\`\`bash
   update-command --dry-run --filter "pattern"
   \`\`\`

3. **Apply after confirmation**
   \`\`\`bash
   update-command --apply --filter "pattern"
   \`\`\`

## Scenario: Single Item

For individual item updates, use the simpler flow...
```

## Effective Description Patterns

### Good Descriptions (specific triggers)

```yaml
# Lists specific actions and anti-patterns
description: Process and import bank statements from PDF files. Use when asked to import statements, process PDFs, or extract transactions. Does NOT categorize - use transaction-categorizer for that.

# Includes question patterns
description: Answer questions about transactions using saved queries or SQL. Use when user asks "what is X categorized as?", "show me transactions for Y", or needs specific ledger rows.

# Clarifies scope
description: Analyze spending patterns to generate insights. Use for spending breakdowns, trends, subscriptions, and anomalies. Provides analysis and summaries, not raw transaction lists.
```

### Weak Descriptions (too vague)

```yaml
# Too broad - when would this NOT apply?
description: Help with data processing tasks.

# No trigger phrases - hard for agent to match
description: Manages database operations.
```

## Reference File Patterns

### Cheat Sheet Table

```markdown
# Command Cheat Sheet

| Command | Description | Key Options |
| ------- | ----------- | ----------- |
| `cmd-a` | Does X | `--opt1`, `--opt2` |
| `cmd-b` | Does Y | `--opt3` |

Usage pattern:
\`\`\`bash
cmd-a --opt1 value --format csv
\`\`\`
```

### Schema Reference

```markdown
# Data Schema

## Required Fields

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | integer | Primary key |
| `name` | string | Display name |
| `created_at` | datetime | ISO 8601 format |

## Optional Fields

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `status` | string | "pending" | One of: pending, active, done |
```

## Workflow File Patterns

Workflows in `$SKILL_ROOT/workflows/` should be self-contained procedures:

```markdown
# Specific Task Workflow

## Purpose
One sentence describing what this workflow accomplishes.

## Configuration
<workspace setup with $WORKDIR>

## Data Collection
<steps to gather required data>

## Analysis Steps
<numbered steps for the main work>

## Output Format
<expected results structure>

## Example Output
<concrete example of what success looks like>

## Cleanup
\`\`\`bash
rm -rf $WORKDIR
\`\`\`
```

## Error Handling Patterns

Structure errors for quick agent self-correction:

```markdown
## Common Errors

- **"no such column: field_name"**: The table uses normalized schema. JOIN with related_table: `FROM main_table t JOIN related_table r ON t.foreign_key = r.id`, then use `r.field_name`

- **Empty results**: Verify the time range with `check-command --list`. Try expanding the date range or removing filters.

- **Permission denied**: Ensure prerequisite is installed and on PATH. Run `which tool-name` to verify.

- **Invalid format**: Use exact format `YYYY-MM-DD`. Example: `2025-11-20`, not `11/20/2025`.
```

## Cross-Skill Transition Patterns

Help agents know when to hand off:

```markdown
## Cross-Skill Transitions

- **After import**: Use `categorizer` skill to handle uncategorized items
- **To query results**: Use `query` skill for specific lookups
- **For analysis**: Use `analyzer` skill to generate reports from imported data

## When to Use This Skill vs Others

- **Use this skill** for initial data processing
- **Use other-skill** for post-processing and refinement
```
