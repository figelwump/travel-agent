---
name: create-skill
description: Create new Claude Code skills for this project. Use when user asks to create a skill, add agent capabilities, or build reusable workflows for the codebase.
allowed-tools: Read, Write, Bash, Glob
---

# Create Skill

Teach the agent how to create well-structured Claude Code skills.

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/create-skill`

When executing commands or referencing paths, use `$SKILL_ROOT` only to build absolute paths to helper resources and keep the shell working directory at the repository root.

## Skill Structure

Every skill lives in `.claude/skills/<skill-name>/` and must contain a `SKILL.md` file. Optional subdirectories:
- `scripts/` – skill-specific helper scripts (use `$SKILL_ROOT/scripts/` to reference)
- `reference/` – detailed documentation, schemas, cheat sheets
- `examples/` – code samples and common patterns
- `workflows/` – multi-step procedures for complex tasks

**Important:** Skill-specific scripts should be placed in `$SKILL_ROOT/scripts/`, not in a global directory like `/app/scripts/`. This keeps each skill self-contained and portable.

## Creating a New Skill

### Step 1: Create the skill directory

```bash
mkdir -p .claude/skills/<skill-name>
```

### Step 2: Write the SKILL.md file

Create `.claude/skills/<skill-name>/SKILL.md` with this structure:

```markdown
---
name: <skill-name>
description: <1-2 sentence description of when to trigger this skill>
allowed-tools: <comma-separated list: Bash, Read, Write, Edit, Glob, Grep, etc.>
---

# <Skill Title>

<1-2 sentence overview of what this skill teaches the agent to do.>

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/<skill-name>`

When executing commands or referencing paths, use `$SKILL_ROOT` only to build absolute paths to helper resources and keep the shell working directory at the repository root.

## Prerequisites

- <Required tools, packages, or environment setup>

## Guidelines

- <Key principles for using this skill effectively>
- <Important constraints or best practices>

## Workflow

<Numbered steps with code examples for the primary task>

1. **Step name:**
   ```bash
   example command
   ```

2. **Next step:**
   ```bash
   another command
   ```

## Common Errors

- **Error description**: Explanation and fix

## Reference

- `$SKILL_ROOT/reference/<file>.md` – description
```

### Step 3: Add reference material (if needed)

For complex skills, create reference files in `$SKILL_ROOT/reference/`:

```bash
mkdir -p .claude/skills/<skill-name>/reference
```

Reference files are for:
- Detailed schemas or data formats
- Cheat sheets and quick reference tables
- Configuration options
- API documentation

### Step 4: Add workflows (if needed)

For multi-step procedures that deserve their own documentation:

```bash
mkdir -p .claude/skills/<skill-name>/workflows
```

Workflows should define their own `$WORKDIR` pattern for temporary files and include cleanup instructions.

## Frontmatter Guidelines

**name**: Short identifier matching the directory name (e.g., `spending-analyzer`)

**description**: Critical for skill triggering. Write 1-2 sentences that:
- Describe the skill's purpose
- List specific trigger phrases or user intents
- Clarify what the skill does NOT do (when helpful)

Example:
```yaml
description: Analyze spending patterns and generate reports. Use when user asks about spending breakdowns, trends, subscriptions, or unusual charges. Does NOT retrieve raw transaction lists.
```

**allowed-tools**: Only list tools the skill actually uses. Common sets:
- Read-only: `Read, Glob, Grep`
- With shell commands: `Bash, Read`
- Full editing: `Bash, Read, Write, Edit, Glob, Grep`

## Content Best Practices

**Be concise but complete:**
- Include all necessary steps and code examples
- Omit obvious explanations
- Use code blocks liberally

**Define $SKILL_ROOT at the top of Configuration:**
```markdown
**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/<skill-name>`
```

**Reference files using $SKILL_ROOT:**
```markdown
See `$SKILL_ROOT/reference/schema.md` for field definitions.
```

**Use $WORKDIR for temporary files:**
```markdown
**Workspace root:** `/var/data/skills/tmp/<skill-name>`
Throughout this workflow, `$WORKDIR` refers to: `/var/data/skills/tmp/<skill-name>/<slug>`
```

**Include Common Errors section:**
- Anticipate failure modes
- Provide actionable fixes
- Help agents self-correct

**Add Cross-Skill Transitions:**
```markdown
## Cross-Skill Transitions
- **After completion**: Use `other-skill` to continue workflow
- **For related tasks**: Use `another-skill` for X
```

## Validation

After creating a skill, verify:
1. SKILL.md has valid frontmatter (name, description, allowed-tools)
2. $SKILL_ROOT is defined and used consistently
3. All referenced files exist
4. Code examples are copy-pasteable

```bash
# Check skill structure
ls -la .claude/skills/<skill-name>/

# Verify frontmatter
head -20 .claude/skills/<skill-name>/SKILL.md
```

## Reference

- `$SKILL_ROOT/reference/advanced-patterns.md` – complex skill patterns and edge cases
