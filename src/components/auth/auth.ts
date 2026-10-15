export const AUTH_STORAGE_KEY = "luojia-authenticated";

const AUTHORIZED_USERNAME = "admin";
const AUTHORIZED_PASSWORD = "password123";

export function isValidCredentials(username: string, password: string) {
  return username === AUTHORIZED_USERNAME && password === AUTHORIZED_PASSWORD;
}

export function hasAuthenticatedSession() {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveAuthenticatedSession() {
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
  } catch {
    // Authentication still remains valid for the current render if storage is unavailable.
  }
}
