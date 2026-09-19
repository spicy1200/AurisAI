import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { invoke, takeAuthMessage } from "./tauri";

type Mode = "login" | "register" | "reset";

export type InterviewAccount = {
  userId: string;
  email: string;
  token: string;
};

type Props = {
  persistSettings: () => Promise<void>;
  onLoggedIn: (account: InterviewAccount) => void;
};

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
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
  const submitLabel =
    mode === "login" ? "登录" : mode === "register" ? "注册并进入" : "保存新密码";
  const submitBusy =
    mode === "login" ? "登录中…" : mode === "register" ? "注册中…" : "提交中…";

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero" aria-hidden="true">
          <div className="auth-mark">AurisAI</div>
          <h2 className="auth-hero-title">上场前，先确认是你</h2>
          <p className="auth-hero-copy">
            网站充值与桌面开面使用同一邮箱账户。注册须先收到验证码。
          </p>
        </section>

        <section className="auth-panel">
          <header className="auth-panel-head">
            <p className="auth-kicker">面试账户</p>
            <h1>{title}</h1>
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
              <input
                id={`${uid}-password`}
                type="password"
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
                aria-describedby={
                  fieldErrors.password ? `${uid}-password-err` : undefined
                }
              />
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
                <input
                  id={`${uid}-confirm`}
                  type="password"
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
                {fieldErrors.confirm && (
                  <p className="auth-field-err" id={`${uid}-confirm-err`}>
                    {fieldErrors.confirm}
                  </p>
                )}
              </div>
            )}

            <button className="auth-cta" type="submit" disabled={busy}>
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
