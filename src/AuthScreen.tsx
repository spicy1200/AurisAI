import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { appLogo } from "./brand";
import { invoke, takeAuthMessage } from "./tauri";

type Mode = "login" | "register" | "reset";
type FieldKey = "email" | "password" | "confirm" | "code";

export type InterviewAccount = {
  userId: string;
  email: string;
  token: string;
};

type Props = {
  persistSettings: () => Promise<void>;
  onLoggedIn: (account: InterviewAccount) => void;
};

const LAST_EMAIL_KEY = "aurisai-auth-email";

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email.trim());
  } catch {
    /* ignore */
  }
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5c-5.2 0-9.4 3.3-11 7 1.6 3.7 5.8 7 11 7s9.4-3.3 11-7c-1.6-3.7-5.8-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5A2.5 2.5 0 1 0 12 9.5 2.5 2.5 0 0 0 12 14.5z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.3 2.3 2 3.6l3.1 3.1C3.2 8 1.7 9.9 1 12c1.6 3.7 5.8 7 11 7 1.8 0 3.5-.4 5-.1l3.4 3.5 1.3-1.3L3.3 2.3zM12 17c-3.6 0-6.7-2.1-8.3-5 .7-1.3 1.8-2.5 3.2-3.4l1.8 1.8A5 5 0 0 0 12 17zm0-12c5.2 0 9.4 3.3 11 7-.6 1.4-1.6 2.7-2.9 3.7l-1.5-1.5c.8-.6 1.5-1.4 2-2.2C18.7 9.1 15.6 7 12 7c-.5 0-1 0-1.5.1L8.9 5.5C9.9 5.2 10.9 5 12 5z"
      />
    </svg>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailError(value: string): string {
  const v = value.trim();
  if (!v) return "请填写邮箱";
  if (!EMAIL_RE.test(v)) return "邮箱格式不正确";
  return "";
}

function passwordError(value: string): string {
  if (!value) return "请填写密码";
  if (value.length < 6) return "密码至少 6 位";
  return "";
}

function waitSecondsFromMessage(msg: string, fallback = 60): number {
  const m = String(msg).match(/(\d+)\s*秒/);
  if (m) return Math.max(1, Number(m[1]));
  if (String(msg).includes("过于频繁")) return fallback;
  return 0;
}

export function AuthScreen({
  persistSettings,
  onLoggedIn,
}: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeWait, setCodeWait] = useState(0);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({
    email: "",
    password: "",
    confirm: "",
    code: "",
  });
  const alertRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const uid = useId();

  useEffect(() => {
    const msg = takeAuthMessage();
    if (msg) {
      setFormError(msg);
      setMessage("");
    }
  }, []);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  useEffect(() => {
    if (codeWait <= 0) return;
    const timer = window.setTimeout(() => setCodeWait((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [codeWait]);

  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirm("");
    setCode("");
    setShowPassword(false);
    setShowConfirm(false);
    setFormError("");
    setMessage("");
    setFieldErrors({ email: "", password: "", confirm: "", code: "" });
  }

  function validate(forMode: Mode): boolean {
    const next = {
      email: emailError(email),
      password: passwordError(password),
      confirm: "",
      code: "",
    };
    if (forMode !== "login") {
      if (!code.trim()) next.code = "请填写验证码";
      if (password !== confirm) next.confirm = "两次密码不一致";
    }
    setFieldErrors(next);
    return !next.email && !next.password && !next.confirm && !next.code;
  }

  async function onSendCode(purpose: "register" | "reset") {
    if (sendingRef.current || codeWait > 0) return;
    const err = emailError(email);
    setFieldErrors((prev) => ({ ...prev, email: err }));
    if (err) return;
    setFormError("");
    setMessage("");
    sendingRef.current = true;
    setCodeBusy(true);
    try {
      await persistSettings();
      const msg = await invoke<string>("send_interview_email_code", {
        email,
        purpose,
      });
      setMessage(msg);
      setCodeWait(60);
    } catch (e) {
      const text = String(e);
      setFormError(text);
      const wait = waitSecondsFromMessage(text);
      if (wait) setCodeWait(wait);
    } finally {
      sendingRef.current = false;
      setCodeBusy(false);
    }
  }

  async function onLogin(ev: FormEvent) {
    ev.preventDefault();
    setFormError("");
    setMessage("");
    if (!validate("login")) {
      setFormError("请先修正表单中的问题");
      return;
    }
    setBusy(true);
    try {
      await persistSettings();
      const acc = await invoke<InterviewAccount>("login_interview", {
        email,
        password,
      });
      rememberEmail(acc.email || email);
      onLoggedIn(acc);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(ev: FormEvent) {
    ev.preventDefault();
    setFormError("");
    setMessage("");
    if (!validate("register")) {
      setFormError("请先修正表单中的问题");
      return;
    }
    setBusy(true);
    try {
      await persistSettings();
      const acc = await invoke<InterviewAccount>("register_interview", {
        email,
        password,
        code,
      });
      rememberEmail(acc.email || email);
      onLoggedIn(acc);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(ev: FormEvent) {
    ev.preventDefault();
    setFormError("");
    setMessage("");
    if (!validate("reset")) {
      setFormError("请先修正表单中的问题");
      return;
    }
    setBusy(true);
    try {
      await persistSettings();
      const msg = await invoke<string>("reset_interview_password", {
        email,
        password,
        code,
      });
      setPassword("");
      setConfirm("");
      setCode("");
      setFieldErrors({ email: "", password: "", confirm: "", code: "" });
      rememberEmail(email);
      setMode("login");
      setMessage(msg);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "login" ? "登录" : mode === "register" ? "创建账户" : "重置密码";
  const subtitle =
    mode === "login"
      ? "用同一邮箱登录后即可开面，网站充值也会记到这个账户。"
      : mode === "register"
        ? "先收验证码，再设至少 6 位密码。"
        : "验证码通过后立刻改密，旧密码失效。";
  const submitLabel =
    mode === "login" ? "登录" : mode === "register" ? "注册并进入" : "保存新密码";
  const submitBusy =
    mode === "login" ? "登录中…" : mode === "register" ? "注册中…" : "提交中…";
  const inlineIssues = (["email", "code", "password", "confirm"] as FieldKey[])
    .filter((key) => fieldErrors[key])
    .map((key) => ({
      key,
      label:
        key === "email"
          ? "邮箱"
          : key === "code"
            ? "验证码"
            : key === "confirm"
              ? mode === "reset"
                ? "确认新密码"
                : "确认密码"
              : mode === "reset"
                ? "新密码"
                : "密码",
      text: fieldErrors[key],
    }));

  function focusField(key: FieldKey) {
    document.getElementById(`${uid}-${key}`)?.focus();
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero" aria-hidden="true">
          <p className="auth-mark">
            <img className="auth-logo" src={appLogo} alt="" width="28" height="40" />
            AurisAI
          </p>
          <h2 className="auth-hero-title">听清这题，再开口</h2>
          <blockquote className="auth-listen">
            请介绍一下你最近做的系统。
          </blockquote>
          <p className="auth-hero-copy">
            网站充值与桌面开面用同一个邮箱。注册须先收到验证码，约 5 分钟有效。
          </p>
        </section>

        <section className="auth-panel">
          <header className="auth-panel-head">
            <h1>{title}</h1>
            <p className="auth-lead">{subtitle}</p>
          </header>

          {formError && (
            <div
              className="auth-alert"
              role="alert"
              tabIndex={-1}
              ref={alertRef}
              aria-labelledby={`${uid}-err-title`}
            >
              <strong id={`${uid}-err-title`}>
                {formError.includes("过于频繁") ? "请稍候再发" : "无法继续"}
              </strong>
              <p>{formError}</p>
              {inlineIssues.length > 0 && (
                <ul className="auth-alert-list">
                  {inlineIssues.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="auth-alert-link"
                        onClick={() => focusField(item.key)}
                      >
                        {item.label}：{item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {message && (
            <p className="auth-ok" role="status">
              {message}
            </p>
          )}

          <form
            className="auth-form"
            onSubmit={
              mode === "login"
                ? onLogin
                : mode === "register"
                  ? onRegister
                  : onReset
            }
            noValidate
          >
            <div className="auth-field">
              <label htmlFor={`${uid}-email`}>邮箱</label>
              <input
                id={`${uid}-email`}
                type="email"
                autoComplete="username"
                autoFocus
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() =>
                  setFieldErrors((prev) => ({
                    ...prev,
                    email: email ? emailError(email) : prev.email,
                  }))
                }
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? `${uid}-email-err` : undefined
                }
              />
              {fieldErrors.email && (
                <p className="auth-field-err" id={`${uid}-email-err`}>
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {mode !== "login" && (
              <div className="auth-field">
                <label htmlFor={`${uid}-code`}>验证码</label>
                <div className="auth-code-row">
                  <input
                    id={`${uid}-code`}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    aria-invalid={Boolean(fieldErrors.code)}
                    aria-describedby={
                      fieldErrors.code ? `${uid}-code-err` : undefined
                    }
                  />
                  <button
                    className="auth-secondary"
                    type="button"
                    disabled={codeBusy || codeWait > 0}
                    onClick={() =>
                      onSendCode(mode === "reset" ? "reset" : "register")
                    }
                  >
                    {codeBusy
                      ? "发送中…"
                      : codeWait > 0
                        ? `${codeWait}s 后可重发`
                        : "发送验证码"}
                  </button>
                </div>
                {fieldErrors.code && (
                  <p className="auth-field-err" id={`${uid}-code-err`}>
                    {fieldErrors.code}
                  </p>
                )}
              </div>
            )}

            <div className="auth-field">
              <label htmlFor={`${uid}-password`}>
                {mode === "reset" ? "新密码" : "密码"}
              </label>
              <div className="auth-secret">
                <input
                  id={`${uid}-password`}
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() =>
                    setFieldErrors((prev) => ({
                      ...prev,
                      password: password ? passwordError(password) : prev.password,
                    }))
                  }
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={`${uid}-password-hint${
                    fieldErrors.password ? ` ${uid}-password-err` : ""
                  }`}
                />
                <button
                  className="auth-reveal"
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              <p className="auth-hint" id={`${uid}-password-hint`}>
                至少 6 位，可用密码管理器自动填充
              </p>
              {fieldErrors.password && (
                <p className="auth-field-err" id={`${uid}-password-err`}>
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {mode !== "login" && (
              <div className="auth-field">
                <label htmlFor={`${uid}-confirm`}>
                  {mode === "reset" ? "确认新密码" : "确认密码"}
                </label>
                <div className="auth-secret">
                  <input
                    id={`${uid}-confirm`}
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onBlur={() =>
                      setFieldErrors((prev) => ({
                        ...prev,
                        confirm:
                          confirm && confirm !== password
                            ? "两次密码不一致"
                            : "",
                      }))
                    }
                    aria-invalid={Boolean(fieldErrors.confirm)}
                    aria-describedby={
                      fieldErrors.confirm ? `${uid}-confirm-err` : undefined
                    }
                  />
                  <button
                    className="auth-reveal"
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? "隐藏确认密码" : "显示确认密码"}
                    aria-pressed={showConfirm}
                  >
                    {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {fieldErrors.confirm && (
                  <p className="auth-field-err" id={`${uid}-confirm-err`}>
                    {fieldErrors.confirm}
                  </p>
                )}
              </div>
            )}

            <button
              className="auth-cta"
              type="submit"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? submitBusy : submitLabel}
            </button>
          </form>

          <nav className="auth-switch" aria-label="其他账户操作">
            {mode !== "login" && (
              <button type="button" className="auth-link" onClick={() => switchMode("login")}>
                返回登录
              </button>
            )}
            {mode === "login" && (
              <>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => switchMode("register")}
                >
                  没有账号？注册
                </button>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => switchMode("reset")}
                >
                  忘记密码
                </button>
              </>
            )}
          </nav>
        </section>
      </div>
    </div>
  );
}
