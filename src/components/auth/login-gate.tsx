"use client";

import { ArrowRight, Compass, LockKeyhole } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  hasAuthenticatedSession,
  isValidCredentials,
  saveAuthenticatedSession,
} from "./auth";
import styles from "./login-gate.module.css";

type AuthState = "checking" | "signed-out" | "signed-in";

export default function LoginGate({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Keep the browser-only session check out of the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthState(hasAuthenticatedSession() ? "signed-in" : "signed-out");
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    if (!isValidCredentials(username.trim(), password)) {
      setError("用户名或密码不正确，请重试。");
      setSubmitting(false);
      return;
    }

    saveAuthenticatedSession();
    setAuthState("signed-in");
    setSubmitting(false);
  }

  if (authState === "checking") {
    return (
      <main className={styles.shell} aria-live="polite">
        <span className={styles.loading}>正在准备珞珈畅行…</span>
      </main>
    );
  }

  if (authState === "signed-in") return children;

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="login-heading">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <Compass size={25} strokeWidth={1.8} />
          </span>
          <div>
            <strong className={styles.brandName}>珞珈畅行</strong>
            <small className={styles.brandCaption}>
              WUHAN UNIVERSITY TRANSIT
            </small>
          </div>
        </div>

        <h1 id="login-heading" className={styles.heading}>
          登录工作台
        </h1>
        <p className={styles.intro}>请输入账号信息，继续访问校园出行工具。</p>

        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="auth-username">用户名</label>
            <input
              id="auth-username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="请输入用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="auth-password">密码</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="请输入密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button className={styles.submit} type="submit" disabled={submitting}>
            <LockKeyhole size={16} />
            <span>{submitting ? "正在登录" : "登录"}</span>
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>

        <p className={styles.footer}>内部开发预览 · 账号权限受限</p>
      </section>
    </main>
  );
}
