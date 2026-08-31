export const MEDIA_EXTENSIONS = new Set([
  '.gif', '.jpeg', '.jpg', '.m4v', '.mov', '.mp4', '.png', '.svg', '.webm', '.webp',
]);

const RULES = [
  ['private IPv4 address', /(?<!\d)(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?!\d)/],
  ['macOS user path', /\/Users\/[^/\s"']+/],
  ['Linux user path', /\/home\/[^/\s"']+/],
  ['Windows user path', /[A-Z]:\\Users\\[^\\\s"']+/i],
  ['private LAN hostname', /\b[a-z0-9.-]+\.(?:lan|local|home\.arpa)\b/i],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[opsu]_[A-Za-z0-9]{20,}\b/],
  ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/],
  ['credentialed URL', /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]{1,80}:[^\s/@]{3,200}@/i],
];

export function parsePrivateLiterals(raw, source = 'private literal policy') {
  const value = JSON.parse(raw);
  const literals = Array.isArray(value) ? value : value?.literals;
  if (!Array.isArray(literals) || literals.some((item) => typeof item !== 'string' || item.length < 3)) {
    throw new TypeError(`${source} must contain an array of string literals at least three characters long`);
  }
  return [...new Set(literals)];
}

export function findSensitiveLabels(text, privateLiterals = []) {
  const labels = new Set();
  for (const [label, pattern] of RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) labels.add(label);
  }
  const normalized = text.toLocaleLowerCase('en-US');
  if (privateLiterals.some((literal) => normalized.includes(literal.toLocaleLowerCase('en-US')))) {
    labels.add('private infrastructure literal');
  }
  return [...labels].sort((left, right) => left.localeCompare(right, 'en-US'));
}

export function representativeFrameTimes(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('durationSeconds must be a positive finite number');
  }
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((ratio) => Number((durationSeconds * ratio).toFixed(3)));
}
