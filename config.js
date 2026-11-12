// What a visitor's key may spend and for how long. Pollen is per visitor.
// An island of four small models for ten rounds costs a few thousandths of a Pollen.
export const BUDGET = 0.5;
export const EXPIRY_DAYS = 1;

// A publishable App Key (pk_) whose redirect URI is this page's address. Empty until one is created;
// when set it is sent as client_id so the consent screen names the app. See BRING_YOUR_OWN_POLLEN.md.
export const APP_KEY = "";

// Agents start with these models, one each, when the live list has them. All are free for every visitor.
export const DEFAULT_AGENT_MODELS = [
    "openai/gpt-5.4-nano",
    "deepseek/deepseek-v4.1-flash",
    "meta/llama-3.3-70b-instruct",
    "minimax/minimax-m3.1-flash",
];

export const ROUND_CHOICES = [6, 10, 16, 24];
export const DEFAULT_ROUNDS = 10;
