/* Plain-language helpers for accounts: initials and errors. */
import { ApiError } from "../api/client";

/** "Ahmed Osama" -> "AO"; an account without a name falls back to its email's first letter. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letters = first ? [first, last].map((word) => (word ? (Array.from(word)[0] ?? "") : "")).join("") : "";
  const fallback = Array.from(email.trim())[0] ?? "?";
  return (letters !== "" ? letters : fallback).toUpperCase();
}

/** An error in plain words: the server's own explanation, or what the failure means for the person reading it. */
export function plainError(error: unknown, fallback = "Something went wrong. Try again in a moment."): string {
  if (error instanceof ApiError) {
    if (error.explained || error.status === 429) return error.message;
    if (error.status === 401) return "You're signed out. Sign in and try again.";
    if (error.status === 403) return "The server refused this request. Reload the page and try again.";
    if (error.status === 404) return "That isn't available any more.";
    if (error.status >= 500) return "Walk-in's server had a problem. Try again in a moment.";
    return fallback;
  }
  if (error instanceof TypeError) return "Walk-in can't be reached. Check your connection and try again.";
  return fallback;
}
