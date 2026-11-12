/**
 * Settings: chrome.storage.sync in the extension (follows the person's
 * Chrome profile), localStorage when these pages are opened as plain pages
 * (the build's preview, tests).
 */
import { DEFAULT_URL } from "./config.js";

const chromeStore = globalThis.chrome?.storage?.sync;

export async function foundationUrl() {
  let url;
  if (chromeStore) url = (await chromeStore.get("foundationUrl")).foundationUrl;
  else {
    try {
      url = localStorage.getItem("foundationUrl");
    } catch {
      /* no storage */
    }
  }
  return clean(url || DEFAULT_URL);
}

export async function setFoundationUrl(url) {
  const u = clean(url);
  if (chromeStore) await chromeStore.set({ foundationUrl: u });
  else localStorage.setItem("foundationUrl", u);
  return u;
}

/** an http(s) origin (and path, if Foundation is served under one), no trailing slash */
export function clean(url) {
  const u = new URL(String(url).trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Foundation's address starts with http:// or https://");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Today on Foundation, marked as opened from Chrome */
export const todayUrl = (base) => `${base}/?from=chrome#/today`;

export function night() {
  if (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("is-night");
}
