export type ChatSuggestion = { label: string; prompt: string };

type TodoItem = { line: number; text: string; checked: boolean };

type QuestionItem = { line: number; text: string; isQuestion: boolean };

const TODO_REGEX = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/;
const CODE_FENCE_REGEX = /^\s*```/;
const PLACEHOLDER_REGEX = /\b(tbd|tba|tbc|to decide|unknown|undecided)\b|\?\?\?/i;

const BOOKING_KEYWORDS = [
  'book',
  'booking',
  'reserve',
  'reservation',
  'tickets',
  'ticket',
  'flight',
  'airfare',
  'hotel',
  'lodging',
  'accommodation',
  'hostel',
  'airbnb',
  'car rental',
  'rental car',
  'car hire',
  'tour',
  'activity',
  'museum',
  'entry',
  'permit',
  'pass',
  'parking',
  'ferry',
  'train',
  'bus',
  'shuttle',
  'transfer',
];

const DECISION_KEYWORDS = ['decide', 'choose', 'pick', 'select', 'narrow', 'shortlist', 'figure out', 'lock in'];
const CONFIRM_KEYWORDS = ['confirm', 'verify', 'check', 'call', 'email', 'reconfirm', 'double-check'];
const PLAN_KEYWORDS = ['plan', 'map', 'route', 'schedule', 'itinerary', 'timeline', 'logistics', 'drive', 'transit'];
const BUDGET_KEYWORDS = ['budget', 'cost', 'price', 'pricing', 'estimate', 'fee'];

const MAX_LABEL_LENGTH = 44;
const MAX_SUGGESTIONS = 4;

function normalizeTodoText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripListPrefix(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .trim();
}

function shortenLabel(text: string, maxLength = MAX_LABEL_LENGTH): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return truncated.length > 0 ? `${truncated}...` : text.slice(0, maxLength);
}

function removeLeadingVerb(text: string, verbs: string[]): string {
  const pattern = new RegExp(`^(${verbs.join('|')})\\b\s*`, 'i');
  return text.replace(pattern, '').trim();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function parseItineraryTodos(markdown: string): TodoItem[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const todos: TodoItem[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (CODE_FENCE_REGEX.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(TODO_REGEX);
    if (!match) continue;
    const checked = match[1].toLowerCase() === 'x';
    todos.push({ line: i + 1, text: match[2].trim(), checked });
  }

  return todos;
}

function parseOpenQuestions(markdown: string): QuestionItem[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const questions: QuestionItem[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (CODE_FENCE_REGEX.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (!line.trim()) continue;
    if (TODO_REGEX.test(line)) continue;

    const normalizedLine = normalizeTodoText(stripListPrefix(line));
    if (!normalizedLine) continue;
    const hasPlaceholder = PLACEHOLDER_REGEX.test(normalizedLine);
    const isQuestion = normalizedLine.endsWith('?') || normalizedLine.includes('?');
    if (!hasPlaceholder && !isQuestion) continue;

    questions.push({ line: i + 1, text: normalizedLine, isQuestion });
  }

  return questions;
}

function cleanQuestionText(text: string): string {
  return normalizeTodoText(
    text
      .replace(/\?+$/g, '')
      .replace(/\b(tbd|tba|tbc|to decide|unknown|undecided)\b/gi, '')
      .replace(/\s*[:\-]\s*$/g, '')
  );
}

function buildTodoSuggestion(text: string): ChatSuggestion | null {
  const normalized = normalizeTodoText(text);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();

  let labelPrefix = 'Handle';
  let prompt = `Help me tackle ${normalized}. Ask any clarifying questions first.`;
  let verbsToRemove: string[] = [];

  if (includesAny(lower, DECISION_KEYWORDS)) {
    labelPrefix = 'Decide';
    prompt = `Help me decide ${normalized}. Ask me the right questions first.`;
    verbsToRemove = ['decide', 'choose', 'pick', 'select'];
  } else if (includesAny(lower, CONFIRM_KEYWORDS)) {
    labelPrefix = 'Confirm';
    prompt = `Help me confirm ${normalized}. Tell me what info you need and what to check.`;
    verbsToRemove = ['confirm', 'verify', 'check'];
  } else if (includesAny(lower, BUDGET_KEYWORDS)) {
    labelPrefix = 'Budget';
    prompt = `Help me estimate costs for ${normalized} and flag likely price ranges.`;
    verbsToRemove = ['budget', 'estimate'];
  } else if (includesAny(lower, PLAN_KEYWORDS)) {
    labelPrefix = 'Plan';
    prompt = `Help me plan ${normalized}. Propose a simple plan and timeline.`;
    verbsToRemove = ['plan', 'map', 'route', 'schedule'];
  } else if (includesAny(lower, BOOKING_KEYWORDS)) {
    labelPrefix = 'Book';
    prompt = `Help me book ${normalized}. Suggest options and ask me for the details you need.`;
    verbsToRemove = ['book', 'reserve', 'buy'];
  }

  const cleaned = verbsToRemove.length > 0 ? removeLeadingVerb(normalized, verbsToRemove) : normalized;
  const labelText = shortenLabel(cleaned);
  return { label: `${labelPrefix}: ${labelText}`, prompt };
}

function buildQuestionSuggestion(item: QuestionItem): ChatSuggestion | null {
  const cleaned = cleanQuestionText(item.text) || item.text.replace(/\?+$/g, '');
  if (!cleaned) return null;
  const labelText = shortenLabel(cleaned);
  const prompt = `Help me resolve ${cleaned}.`;
  const prefix = item.isQuestion ? 'Answer' : 'Fill in';
  return { label: `${prefix}: ${labelText}`, prompt };
}

function buildFallbackSuggestions(tripName: string | null, itineraryMarkdown: string): ChatSuggestion[] {
  const hasItinerary = itineraryMarkdown.trim().length > 0;
  if (!tripName) return [];
  if (!hasItinerary) {
    return [
      {
        label: 'Draft the itinerary',
        prompt: `Build a first-draft itinerary for ${tripName}. Ask me for dates, budget, and preferences first.`,
      },
      {
        label: 'Collect bookings',
        prompt: 'Ask me what I have already booked or reserved so we can fill in the gaps.',
      },
      {
        label: 'Clarify priorities',
        prompt: 'Help me clarify my must-dos and priorities for this trip.',
      },
      {
        label: 'Outline budget',
        prompt: 'Help me estimate a budget and rough cost breakdown for this trip.',
      },
    ];
  }

  return [
    {
      label: 'Review missing details',
      prompt: 'Review the itinerary and flag any missing details, conflicts, or timing issues.',
    },
    {
      label: 'Prioritize bookings',
      prompt: 'Based on this itinerary, what should I book next and by when?',
    },
    {
      label: 'Optimize the schedule',
      prompt: 'Optimize the day-by-day schedule for pace and transit time.',
    },
    {
      label: 'Build a packing list',
      prompt: 'Create a packing list tailored to this trip and season.',
    },
  ];
}

export function buildChatSuggestions(tripName: string | null, itineraryMarkdown: string): ChatSuggestion[] {
  if (!tripName) return [];
  const suggestions: ChatSuggestion[] = [];
  const seen = new Set<string>();

  const pushSuggestion = (suggestion: ChatSuggestion | null) => {
    if (!suggestion) return;
    const key = suggestion.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  const openTodos = parseItineraryTodos(itineraryMarkdown)
    .filter((todo) => !todo.checked)
    .slice(0, MAX_SUGGESTIONS * 2);
  for (const todo of openTodos) {
    pushSuggestion(buildTodoSuggestion(todo.text));
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  const openQuestions = parseOpenQuestions(itineraryMarkdown).slice(0, MAX_SUGGESTIONS * 2);
  for (const question of openQuestions) {
    pushSuggestion(buildQuestionSuggestion(question));
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  for (const suggestion of buildFallbackSuggestions(tripName, itineraryMarkdown)) {
    pushSuggestion(suggestion);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
